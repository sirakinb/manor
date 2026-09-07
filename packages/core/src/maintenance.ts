import type { MaintenanceJob, MaintenanceReview } from "@rakazo/contracts";

export function maintenanceCanApprove(job: MaintenanceJob): boolean {
  return job.status === "review" && Boolean(job.reviewKey) && maintenanceReviewPassed(job.review);
}

export function maintenanceReviewPassed(review: MaintenanceReview | null): boolean {
  return Boolean(
    review?.isolationVerified &&
      review.publicationSafe &&
      review.requiredChecksPassed &&
      review.checks.length &&
      review.checks.every((check) => check.passed),
  );
}

export function maintenanceUpdateAdvice(job: MaintenanceJob): string {
  if (job.simulated) return "Test adapter: no source code or deployment was changed.";
  if (job.status !== "completed" || !job.review) return "";
  const { web, desktop, mobile } = job.review.updates;
  return [
    web
      ? "Save unsent work, then reload the browser or desktop window."
      : "No browser reload is required.",
    desktop
      ? "Install the new desktop release for native changes."
      : "The desktop app does not need a new installer.",
    mobile
      ? "Install the new mobile release for native changes."
      : "The mobile app does not need an update.",
  ].join(" ");
}
