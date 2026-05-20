import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { makeTestClient } from "../../../../tests/integration/_helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// siteOrigin() reads request headers; integration tests run with no request
// scope, so stub the bag to return a deterministic host. Returning a Headers
// instance keeps `.get(...)` behaviour faithful.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000" }),
}));

vi.mock("@/lib/supabase/server", async () => {
  const { makeTestClient } = await import(
    "../../../../tests/integration/_helpers"
  );
  const client = makeTestClient();
  return {
    createSupabaseServerClient: async () => client,
    createSupabaseServiceClient: () => client,
  };
});

// Imports of the actions MUST come after the mocks above.
import {
  adminResetPassword,
  adminSendMagicLink,
  adminUpdateUserAvatar,
  adminUpdateUserDisplayName,
  deleteUser,
  inviteUser,
} from "./actions";

const sb = makeTestClient();

/**
 * Mint a unique e2e email per call. The integration suite shares the local
 * Supabase auth schema with sibling tests / leftover state, so colliding on a
 * fixed address would surface as "duplicate user" failures. Date.now plus a
 * random suffix is enough — auth.users has no UNIQUE besides email/id.
 */
function makeTestEmail(tag: string): string {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  return `int-${tag}-${suffix}@e2e.test`;
}

async function findUserByEmail(email: string) {
  const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email === email) ?? null;
}

async function deleteUserById(userId: string | null | undefined) {
  if (!userId) return;
  await sb.auth.admin.deleteUser(userId);
}

beforeEach(() => {
  vi.mocked(revalidatePath).mockClear();
});

// NOTE: `changeOwnPassword` and `updateOwnProfile` are intentionally NOT
// covered here. Both require a signed-in user (they call
// `supabase.auth.getUser()` and read `me.user.email` / `me.user.id`). The
// mocked `createSupabaseServerClient` returns a service-role client with no
// session — `getUser()` resolves `{ user: null }`, so both actions short-
// circuit on "Not signed in". Half-mocking around that would only re-test the
// mock. These paths are exercised end-to-end in `tests/e2e/auth-users.spec.ts`.

describe("inviteUser", () => {
  it("should create a new auth user, revalidate /settings, and return success state", async () => {
    const email = makeTestEmail("invite-ok");
    let createdId: string | null = null;

    try {
      const fd = new FormData();
      fd.set("email", email);

      const result = await inviteUser({ status: "idle" }, fd);

      expect(result).toEqual({ status: "success", email });
      expect(revalidatePath).toHaveBeenCalledWith("/settings");

      const found = await findUserByEmail(email);
      expect(found).not.toBeNull();
      createdId = found?.id ?? null;

      // The action seeds an animal avatar in user_metadata so the new user
      // shows up with a distinct icon/color in /settings.
      const meta = found?.user_metadata ?? {};
      expect(meta.avatar_icon_type).toBe("animal");
      expect(typeof meta.avatar_icon_value).toBe("string");
      expect(meta.avatar_color_hex).toMatch(/^#[0-9a-f]{6}$/i);
    } finally {
      await deleteUserById(createdId);
    }
  });

  it("should return an error state for an invalid email without calling revalidatePath", async () => {
    const fd = new FormData();
    fd.set("email", "not-an-email");

    const result = await inviteUser({ status: "idle" }, fd);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error).toMatch(/valid email/i);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("adminResetPassword", () => {
  it("should not throw for a valid email on an existing user", async () => {
    const email = makeTestEmail("reset-ok");
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr || !created.user) throw createErr ?? new Error("create failed");

    try {
      const fd = new FormData();
      fd.set("email", email);
      await expect(adminResetPassword(fd)).resolves.toBeUndefined();
    } finally {
      await deleteUserById(created.user.id);
    }
  });

  it("should throw with the validation error when the email is malformed", async () => {
    const fd = new FormData();
    fd.set("email", "   ");

    await expect(adminResetPassword(fd)).rejects.toThrow(/email is required/i);
  });
});

describe("adminSendMagicLink", () => {
  it("should not throw for a valid email on an existing user", async () => {
    const email = makeTestEmail("magic-ok");
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr || !created.user) throw createErr ?? new Error("create failed");

    try {
      const fd = new FormData();
      fd.set("email", email);
      await expect(adminSendMagicLink(fd)).resolves.toBeUndefined();
    } finally {
      await deleteUserById(created.user.id);
    }
  });

  it("should throw the validation error for a malformed email", async () => {
    const fd = new FormData();
    fd.set("email", "nope");

    await expect(adminSendMagicLink(fd)).rejects.toThrow(/valid email/i);
  });
});

describe("adminUpdateUserDisplayName", () => {
  it("should persist the new display_name in user_metadata and revalidate /settings + /", async () => {
    const email = makeTestEmail("name-ok");
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { display_name: "Old Name", avatar_color_hex: "#112233" },
    });
    if (createErr || !created.user) throw createErr ?? new Error("create failed");

    try {
      const fd = new FormData();
      fd.set("userId", created.user.id);
      fd.set("display_name", "  Captain New  ");

      await adminUpdateUserDisplayName(fd);

      const { data: refreshed } = await sb.auth.admin.getUserById(created.user.id);
      const meta = refreshed.user?.user_metadata ?? {};
      // Whitespace is trimmed by the action.
      expect(meta.display_name).toBe("Captain New");
      // Existing metadata fields are preserved (the action merges, not replaces).
      expect(meta.avatar_color_hex).toBe("#112233");

      expect(revalidatePath).toHaveBeenCalledWith("/settings");
      expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    } finally {
      await deleteUserById(created.user.id);
    }
  });

  it("should store null for an empty display_name", async () => {
    const email = makeTestEmail("name-empty");
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { display_name: "Will Be Cleared" },
    });
    if (createErr || !created.user) throw createErr ?? new Error("create failed");

    try {
      const fd = new FormData();
      fd.set("userId", created.user.id);
      fd.set("display_name", "   ");

      await adminUpdateUserDisplayName(fd);

      const { data: refreshed } = await sb.auth.admin.getUserById(created.user.id);
      // Supabase's user_metadata merge may omit cleared keys rather than
      // store explicit null — coerce undefined to null for the assertion.
      expect(refreshed.user?.user_metadata?.display_name ?? null).toBeNull();
    } finally {
      await deleteUserById(created.user.id);
    }
  });

  it("should throw when userId is missing", async () => {
    const fd = new FormData();
    fd.set("display_name", "Anything");

    await expect(adminUpdateUserDisplayName(fd)).rejects.toThrow(/userId/i);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("adminUpdateUserAvatar", () => {
  it("should persist parsed avatar fields and revalidate /settings + /", async () => {
    const email = makeTestEmail("avatar-ok");
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { display_name: "Keep Me" },
    });
    if (createErr || !created.user) throw createErr ?? new Error("create failed");

    try {
      const fd = new FormData();
      fd.set("userId", created.user.id);
      fd.set("avatar_icon_type", "animal");
      fd.set("avatar_icon_value", "fox:fill");
      fd.set("avatar_color_hex", "#aabbcc");

      await adminUpdateUserAvatar(fd);

      const { data: refreshed } = await sb.auth.admin.getUserById(created.user.id);
      const meta = refreshed.user?.user_metadata ?? {};
      expect(meta.avatar_icon_type).toBe("animal");
      expect(meta.avatar_icon_value).toBe("fox:fill");
      expect(meta.avatar_color_hex).toBe("#aabbcc");
      // Existing metadata is preserved (merge, not replace).
      expect(meta.display_name).toBe("Keep Me");

      expect(revalidatePath).toHaveBeenCalledWith("/settings");
      expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    } finally {
      await deleteUserById(created.user.id);
    }
  });

  it("should null out fields that don't match the validation rules", async () => {
    // parseAvatarFields rejects icon types outside ICON_TYPES and color values
    // that aren't 6-char hex with a leading #. We need that defence — a bad
    // payload would otherwise propagate into the avatar component.
    const email = makeTestEmail("avatar-bad");
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr || !created.user) throw createErr ?? new Error("create failed");

    try {
      const fd = new FormData();
      fd.set("userId", created.user.id);
      fd.set("avatar_icon_type", "not-a-real-icon-type");
      fd.set("avatar_icon_value", "");
      fd.set("avatar_color_hex", "red"); // not /^#[0-9a-fA-F]{6}$/

      await adminUpdateUserAvatar(fd);

      const { data: refreshed } = await sb.auth.admin.getUserById(created.user.id);
      const meta = refreshed.user?.user_metadata ?? {};
      // Cleared metadata keys may be omitted entirely; coerce undefined → null.
      expect(meta.avatar_icon_type ?? null).toBeNull();
      expect(meta.avatar_icon_value ?? null).toBeNull();
      expect(meta.avatar_color_hex ?? null).toBeNull();
    } finally {
      await deleteUserById(created.user.id);
    }
  });

  it("should throw when userId is missing", async () => {
    const fd = new FormData();
    fd.set("avatar_icon_type", "animal");

    await expect(adminUpdateUserAvatar(fd)).rejects.toThrow(/userId/i);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteUser", () => {
  it("should throw when userId is missing", async () => {
    const fd = new FormData();
    await expect(deleteUser(fd)).rejects.toThrow(/userId/i);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("should refuse to run with no signed-in user (service-role client returns no session)", async () => {
    // The mocked createSupabaseServerClient is service-role with no session,
    // so server.auth.getUser() resolves { user: null } and the action bails
    // out before touching auth.admin.deleteUser. This is the only path the
    // harness can exercise; the canDeleteUser self-delete guard requires a
    // real session and is covered in tests/e2e/auth-users.spec.ts.
    const email = makeTestEmail("delete-noauth");
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createErr || !created.user) throw createErr ?? new Error("create failed");

    try {
      const fd = new FormData();
      fd.set("userId", created.user.id);
      await expect(deleteUser(fd)).rejects.toThrow(/not signed in/i);

      // The user must still exist — the action threw before deleting.
      const stillThere = await findUserByEmail(email);
      expect(stillThere?.id).toBe(created.user.id);
      expect(revalidatePath).not.toHaveBeenCalled();
    } finally {
      await deleteUserById(created.user.id);
    }
  });
});

// Belt-and-braces sweep: if a test threw mid-flight before its finally block
// ran, we still want to leave the auth schema clean for the next file in the
// integration run.
afterEach(async () => {
  const { data } = await sb.auth.admin.listUsers({ perPage: 200 });
  for (const u of data.users as Array<{ id: string; email?: string | null }>) {
    if (u.email?.startsWith("int-") && u.email.endsWith("@e2e.test")) {
      await sb.auth.admin.deleteUser(u.id);
    }
  }
});
