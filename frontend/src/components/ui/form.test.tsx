import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "@tests/helpers/axe";
import { renderUi } from "@tests/helpers/render";
import { Checkbox, RadioGroup, Switch } from "./choice";
import { FormField } from "./form-field";
import { Input, PhoneInput, Select, Textarea } from "./inputs";

describe("FormField", () => {
  it("connects label, hint and error to the control", () => {
    renderUi(
      <FormField label="First name" hint="As on your ID" error="Required">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText("First name");
    expect(input).toHaveAccessibleDescription("As on your ID Required");
    expect(input).toBeInvalid();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("marks required fields in words for screen readers and with a star visually", () => {
    renderUi(
      <FormField label="Phone" required>
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText(/Phone/)).toBeRequired();
    expect(screen.getByText("(required)")).toHaveClass("sr-only");
  });

  it("says optional fields are optional, in the active language", () => {
    renderUi(
      <FormField label="Notes" optional>
        <Textarea />
      </FormField>,
      "am",
    );
    expect(screen.getByText("(አማራጭ)")).toBeInTheDocument();
  });

  it("can hide the label visually but keep it for assistive technology", () => {
    renderUi(
      <FormField label="Search" hideLabel>
        <Input />
      </FormField>,
    );
    expect(screen.getByText("Search")).toHaveClass("sr-only");
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
  });

  it("announces a newly shown error through an always-present polite region", () => {
    const { container, rerender } = renderUi(
      <FormField label="Email">
        <Input />
      </FormField>,
    );
    const region = container.querySelector('[aria-live="polite"]');
    expect(region).toBeEmptyDOMElement();
    rerender(
      <FormField label="Email" error="Enter a valid email">
        <Input />
      </FormField>,
    );
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent(
      "Enter a valid email",
    );
  });

  it("works with Select and Textarea as well", () => {
    renderUi(
      <>
        <FormField label="Branch">
          <Select defaultValue="b">
            <option value="a">A</option>
            <option value="b">B</option>
          </Select>
        </FormField>
        <FormField label="Notes" error="Too long">
          <Textarea />
        </FormField>
      </>,
    );
    expect(screen.getByLabelText("Branch")).toHaveValue("b");
    expect(screen.getByLabelText("Notes")).toBeInvalid();
  });

  it("has no accessibility violations (English and Amharic)", async () => {
    for (const locale of ["en", "am"] as const) {
      const { container, unmount } = renderUi(
        <form>
          <FormField label="Name" required hint="Hint">
            <Input />
          </FormField>
          <FormField label="Phone" error="Bad number">
            <PhoneInput />
          </FormField>
        </form>,
        locale,
      );
      await expectNoA11yViolations(container);
      unmount();
    }
  });
});

describe("PhoneInput", () => {
  it("shows the country code and drops characters that cannot be part of a number", async () => {
    const onChange = vi.fn();
    renderUi(
      <FormField label="Phone">
        <PhoneInput onChange={onChange} />
      </FormField>,
    );
    expect(screen.getByText("+251")).toBeInTheDocument();
    const input = screen.getByLabelText("Phone");
    expect(input).toHaveAttribute("type", "tel");
    expect(input).toHaveAttribute("inputmode", "tel");
    expect(input).toHaveAttribute("autocomplete", "tel-national");
    await userEvent.type(input, "09a1-1 2b3");
    expect(input).toHaveValue("091-1 23");
  });
});

describe("Checkbox", () => {
  it("toggles from its label and links description and error", async () => {
    renderUi(<Checkbox label="I agree" description="Required to join" error="You must agree" />);
    const box = screen.getByRole("checkbox", { name: "I agree" });
    expect(box).toHaveAccessibleDescription(/Required to join/);
    expect(box).toBeInvalid();
    await userEvent.click(screen.getByText("I agree"));
    expect(box).toBeChecked();
  });
});

describe("RadioGroup", () => {
  function Harness({ onChange }: { onChange: (v: string) => void }) {
    const [value, setValue] = useState("en");
    return (
      <RadioGroup
        name="lang"
        legend="Language"
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        options={[
          { value: "en", label: "English" },
          { value: "am", label: "አማርኛ" },
          { value: "xx", label: "Other", disabled: true },
        ]}
      />
    );
  }

  it("is a named group that moves with the arrow keys and skips disabled options", async () => {
    const onChange = vi.fn();
    renderUi(<Harness onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "English" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "አማርኛ" })).toBeChecked();
    expect(onChange).toHaveBeenLastCalledWith("am");
    expect(screen.getByRole("radio", { name: "Other" })).toBeDisabled();
  });
});

describe("Switch", () => {
  it("is a named switch toggled by click and by Space", async () => {
    const onChange = vi.fn();
    function Harness() {
      const [on, setOn] = useState(false);
      return (
        <Switch
          checked={on}
          onCheckedChange={(next) => {
            setOn(next);
            onChange(next);
          }}
          label="Marketing"
          description="Offers"
        />
      );
    }
    renderUi(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Marketing" });
    expect(toggle).toHaveAccessibleDescription("Offers");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    toggle.focus();
    await userEvent.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });
});
