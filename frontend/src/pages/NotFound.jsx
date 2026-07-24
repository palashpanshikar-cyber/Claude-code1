import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        <h1 className="font-heading text-6xl font-light text-muted-foreground">404</h1>
        <p className="mt-4 text-lg font-medium">Page not found</p>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist.
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex h-11 items-center rounded-xl border border-border bg-card px-4 text-sm font-medium hover:bg-accent"
        >
          Back to gyms
        </Link>
      </div>
    </div>
  );
}
