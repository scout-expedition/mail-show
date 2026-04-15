export default function AppLoading() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex items-center justify-center py-24"
    >
      <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-foreground" />
    </div>
  );
}
