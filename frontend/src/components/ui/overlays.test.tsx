import { act, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "@tests/helpers/axe";
import { renderUi } from "@tests/helpers/render";
import { Button } from "./button";
import { ConfirmDialog, Dialog, Drawer } from "./dialog";
import { useToast } from "./toast";

describe("Dialog", () => {
  it("is a named modal with its description, opened through showModal", () => {
    renderUi(
      <Dialog open onClose={vi.fn()} title="Pause program" description="Customers cannot join">
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "Pause program" });
    expect(dialog).toHaveAccessibleDescription("Customers cannot join");
    expect(dialog).toHaveAttribute("open");
  });

  it("renders nothing inside while closed", () => {
    renderUi(
      <Dialog open={false} onClose={vi.fn()} title="Hidden">
        <p>Secret</p>
      </Dialog>,
    );
    expect(screen.queryByText("Secret")).toBeNull();
  });

  it("closes from the close button and from a backdrop click", async () => {
    const onClose = vi.fn();
    renderUi(
      <Dialog open onClose={onClose} title="T">
        <p>Body</p>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("dialog", { hidden: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("cannot be dismissed while work is in progress", async () => {
    const onClose = vi.fn();
    renderUi(
      <Dialog open onClose={onClose} title="T" dismissible={false}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await userEvent.click(screen.getByRole("dialog", { hidden: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("locks page scrolling while open and restores it", () => {
    const { unmount } = renderUi(
      <Dialog open onClose={vi.fn()} title="T">
        x
      </Dialog>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("works as a drawer too and has no accessibility violations", async () => {
    const { container } = renderUi(
      <Drawer open onClose={vi.fn()} title="Details" footer={<Button>Save</Button>}>
        <p>Longer form</p>
      </Drawer>,
    );
    expect(screen.getByRole("dialog", { name: "Details" })).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });
});

describe("ConfirmDialog", () => {
  it("cancels without confirming", async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    renderUi(<ConfirmDialog open onCancel={onCancel} onConfirm={onConfirm} title="Sure?" />);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("locks itself while an async confirmation runs, and confirms exactly once", async () => {
    let finish: () => void = () => undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderUi(
      <ConfirmDialog
        open
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        title="Sure?"
        confirmLabel="Do it"
      />,
    );
    const confirm = screen.getByRole("button", { name: "Do it" });
    await userEvent.click(confirm);
    await userEvent.click(confirm); // a double tap
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await act(async () => finish());
    expect(confirm).toBeEnabled();
  });

  it("keeps the strong-confirmation button locked until the phrase is typed exactly", async () => {
    const onConfirm = vi.fn();
    renderUi(
      <ConfirmDialog
        open
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        tone="danger"
        requirePhrase="REVERSE"
        title="Reverse?"
        confirmLabel="Reverse stamp"
      />,
    );
    const confirm = screen.getByRole("button", { name: "Reverse stamp" });
    expect(confirm).toBeDisabled();
    const field = screen.getByLabelText("Type REVERSE to confirm");
    await userEvent.type(field, "reverse");
    expect(confirm).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, "REVERSE");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

function ToastButton({ tone, label }: { tone?: "danger" | "success"; label: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => toast.show({ tone, title: label, description: "Details" })}
    >
      show {label}
    </button>
  );
}

describe("Toast", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("announces success politely and problems assertively", async () => {
    const { container } = renderUi(
      <>
        <ToastButton tone="success" label="Saved" />
        <ToastButton tone="danger" label="Failed" />
      </>,
    );
    await userEvent.click(screen.getByText("show Saved"));
    await userEvent.click(screen.getByText("show Failed"));
    const polite = container.ownerDocument.querySelector('[aria-live="polite"]');
    const assertive = container.ownerDocument.querySelector('[aria-live="assertive"]');
    expect(polite).toHaveTextContent("Saved");
    expect(polite).not.toHaveTextContent("Failed");
    expect(assertive).toHaveTextContent("Failed");
    expect(screen.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
  });

  it("disappears by itself, but not while the pointer is over it", async () => {
    renderUi(<ToastButton tone="success" label="Saved" />);
    await userEvent.click(screen.getByText("show Saved"));
    const toast = screen.getByText("Details").closest("div")!.parentElement!;
    await userEvent.hover(toast);
    act(() => void vi.advanceTimersByTime(8000));
    expect(screen.getByText("Details")).toBeInTheDocument();
    await userEvent.unhover(toast);
    act(() => void vi.advanceTimersByTime(6100));
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("can be dismissed by the user", async () => {
    renderUi(<ToastButton tone="success" label="Saved" />);
    await userEvent.click(screen.getByText("show Saved"));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("refuses to be used outside its provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<ToastButton label="x" />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});

describe("nested dialogs", () => {
  it("closing an inner dialog does not close or block the dialog around it", async () => {
    const outerClosed = vi.fn();
    function Nested() {
      const [inner, setInner] = useState(false);
      return (
        <>
          <Dialog open onClose={outerClosed} title="Outer">
            <button onClick={() => setInner(true)}>Open inner</button>
            <Dialog open={inner} onClose={() => setInner(false)} title="Inner">
              <p>Inside</p>
            </Dialog>
          </Dialog>
        </>
      );
    }
    const user = userEvent.setup();
    renderUi(<Nested />);
    await user.click(screen.getByRole("button", { name: "Open inner" }));
    expect(await screen.findByRole("dialog", { name: "Inner" })).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("dialog", { name: "Inner" })).getByRole("button", { name: "Close" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Inner" })).not.toBeInTheDocument(),
    );
    expect(outerClosed).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Outer" })).toBeInTheDocument();
  });
});
