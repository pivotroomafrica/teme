import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "@tests/helpers/axe";
import { renderUi } from "@tests/helpers/render";
import { Alert } from "./alert";
import { Badge, StatusIndicator } from "./badge";
import { Button } from "./button";
import { MetricCard } from "./metric-card";
import { PageHeading } from "./page-heading";
import { ProgressBar, StampProgress } from "./progress";
import { ConfirmationScreen, EmptyState, ErrorState, Skeleton, SkeletonGroup } from "./states";

describe("Button", () => {
  it("blocks repeat clicks while loading and announces the busy state", async () => {
    const onClick = vi.fn();
    renderUi(
      <Button loading loadingLabel="Saving…" onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("is a 44px touch target and defaults to type=button so it never submits by accident", () => {
    renderUi(<Button>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button).toHaveAttribute("type", "button");
    expect(button.className).toContain("touch-target");
  });

  it("uses red only for the destructive variant", () => {
    renderUi(
      <>
        <Button variant="danger">Delete</Button>
        <Button>Save</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("bg-red-600");
    expect(screen.getByRole("button", { name: "Save" }).className).not.toContain("red");
  });
});

describe("Alert", () => {
  it("announces problems and warnings at once, and information politely", () => {
    renderUi(
      <>
        <Alert tone="danger" title="Invalid card" />
        <Alert tone="warning" title="Expiring" />
        <Alert tone="info" title="FYI" />
        <Alert tone="success" title="Saved" />
      </>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getAllByRole("status")).toHaveLength(2);
  });

  it("speaks the tone, so colour is never the only cue, and can be dismissed", async () => {
    const onDismiss = vi.fn();
    renderUi(<Alert tone="danger" title="Invalid card" onDismiss={onDismiss} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Problem: Invalid card");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("Badge and StatusIndicator", () => {
  it("pair an icon shape with the label", () => {
    const { container } = renderUi(
      <>
        <Badge tone="success">Active</Badge>
        <StatusIndicator tone="danger" label="Failed" />
      </>,
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(container.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(2);
  });
});

describe("StampProgress", () => {
  it("is one labelled image reading 'x of y stamps' in the active language", () => {
    renderUi(<StampProgress current={3} required={8} />);
    expect(screen.getByRole("img", { name: "3 of 8 stamps" })).toBeInTheDocument();
  });

  it("is translated", () => {
    renderUi(<StampProgress current={3} required={8} />, "am");
    expect(screen.getByRole("img", { name: "ከ8 ስታምፕ 3" })).toBeInTheDocument();
  });

  it("clamps impossible values instead of breaking", () => {
    renderUi(<StampProgress current={99} required={5} />);
    expect(screen.getByRole("img", { name: "5 of 5 stamps" })).toBeInTheDocument();
  });

  it("says in words when a reward is ready", () => {
    renderUi(<StampProgress current={8} required={8} rewardReady />);
    expect(screen.getByText("Reward ready")).toBeInTheDocument();
  });

  it("falls back to a progress bar for very long cards", () => {
    renderUi(<StampProgress current={30} required={40} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "30");
  });

  it("shows filled and empty stamps as different shapes, not only colours", () => {
    const { container } = renderUi(<StampProgress current={2} required={4} />);
    const dots = container.querySelectorAll('[role="img"] > span');
    expect(dots).toHaveLength(4);
    expect(dots[0]?.className).toContain("bg-gold-500");
    expect(dots[3]?.className).toContain("border-dashed");
  });
});

describe("ProgressBar", () => {
  it("exposes its value to assistive technology and clamps it", () => {
    renderUi(<ProgressBar label="Completeness" value={150} max={100} />);
    const bar = screen.getByRole("progressbar", { name: "Completeness" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });
});

describe("MetricCard", () => {
  it("shows the label, value and hint without computing anything", () => {
    renderUi(<MetricCard label="New members" value="42" hint="Last 30 days" />);
    expect(screen.getByRole("article", { name: "New members" })).toHaveTextContent("42");
    expect(screen.getByText("Last 30 days")).toBeInTheDocument();
  });

  it("shows a skeleton and busy state while loading", () => {
    renderUi(<MetricCard label="Redeemed" value="9" loading />);
    expect(screen.getByRole("article")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("9")).toBeNull();
  });
});

describe("states", () => {
  it("EmptyState explains and offers a next step", () => {
    renderUi(
      <EmptyState
        title="No customers yet"
        description="Share your QR"
        action={<Button>Download</Button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "No customers yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("ErrorState is announced, shows the support reference and retries", async () => {
    const retry = vi.fn();
    renderUi(<ErrorState title="Could not load" requestId="req_123" onRetry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("req_123");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("SkeletonGroup announces loading once and hides the decorative blocks", () => {
    const { container } = renderUi(
      <SkeletonGroup>
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
      </SkeletonGroup>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading content");
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
  });

  it("ConfirmationScreen is a status with a single heading", () => {
    renderUi(<ConfirmationScreen title="You are in!" description="Card ready" />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "You are in!" })).toBeInTheDocument();
  });
});

describe("PageHeading", () => {
  it("renders one h1 with its supporting content", () => {
    renderUi(
      <PageHeading
        title="Customers"
        description="Everyone"
        eyebrow="Sample Cafe"
        actions={<Button>Add</Button>}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Sample Cafe")).toBeInTheDocument();
  });
});

describe("feedback components accessibility", () => {
  it("have no violations in English or Amharic", async () => {
    for (const locale of ["en", "am"] as const) {
      const { container, unmount } = renderUi(
        <div>
          <PageHeading title="Title" />
          <Alert tone="danger" title="Problem">
            Details
          </Alert>
          <Badge tone="warning">Paused</Badge>
          <StampProgress current={3} required={8} rewardReady />
          <ProgressBar label="Done" value={1} max={4} />
          <MetricCard label="Members" value="5" />
          <EmptyState title="Empty" />
          <ErrorState title="Broken" requestId="r1" onRetry={() => undefined} />
          <ConfirmationScreen headingLevel="h2" title="Done" />
        </div>,
        locale,
      );
      await expectNoA11yViolations(container);
      unmount();
    }
  });
});
