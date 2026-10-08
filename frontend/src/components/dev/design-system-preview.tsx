"use client";

/* Development-only gallery: sample copy is deliberately hardcoded (English and long Amharic) to stress layouts. */

import { useState, type ReactNode } from "react";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  ConfirmationScreen,
  Dialog,
  Drawer,
  DropdownMenu,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  MetricCard,
  PageHeading,
  Pagination,
  PhoneInput,
  ProgressBar,
  RadioGroup,
  RowHeader,
  SearchField,
  Select,
  Skeleton,
  SkeletonGroup,
  StampProgress,
  StatusIndicator,
  Switch,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tabs,
  TextLink,
  Textarea,
  useToast,
} from "@/components/ui";

const LONG_AM =
  "የታማኝነት ካርድዎን በየጊዜው በመጠቀም ተጨማሪ ስታምፕዎችን በመሰብሰብ ልዩ ሽልማቶችን ያግኙ፤ ይህ ጽሑፍ ረጅም ቃላት በትክክል እንደሚጠቀለሉ ለማሳየት የተዘጋጀ ነው።";
const LONG_WORD = "ዓለም-አቀፍ-የታማኝነት-ፕሮግራም-አስተዳደር-ሥርዓት";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-12">
      <h2 id={id} className="mb-4 border-b border-border pb-2 text-2xl font-bold text-green-900">
        {title}
      </h2>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-3">{children}</div>;
}

export function DesignSystemPreview() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [strongConfirm, setStrongConfirm] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [plan, setPlan] = useState("en");
  const [last, setLast] = useState("nothing yet");

  return (
    <div data-testid="design-system">
      <PageHeading
        eyebrow="Development only"
        title="TemelashCard design system"
        description="Every shared component in one place. English and Amharic samples, including long text."
        actions={<ButtonLink href="/en">Back to the app</ButtonLink>}
      />

      <Section id="buttons" title="Buttons and links">
        <Row>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Delete (destructive)</Button>
          <Button disabled>Disabled</Button>
          <Button loading loadingLabel="Saving…">
            Save
          </Button>
          <Button size="lg">Large (staff)</Button>
        </Row>
        <Row>
          <Button variant="secondary">{LONG_AM}</Button>
        </Row>
        <p>
          A <TextLink href="/en">text link</TextLink> and an{" "}
          <TextLink href="https://example.org" external>
            external link
          </TextLink>
          .
        </p>
      </Section>

      <Section id="forms" title="Form controls">
        <form className="grid gap-5 sm:grid-cols-2" onSubmit={(event) => event.preventDefault()}>
          <FormField label="First name" required hint="As you would like staff to greet you.">
            <Input name="first" autoComplete="given-name" />
          </FormField>
          <FormField label="Phone number" required hint="Ethiopian mobile number.">
            <PhoneInput name="phone" />
          </FormField>
          <FormField label="Email" error="Enter an email address like name@example.com.">
            <Input type="email" name="email" defaultValue="not-an-email" />
          </FormField>
          <FormField label="Branch" optional>
            <Select name="branch" defaultValue="bole">
              <option value="bole">Bole</option>
              <option value="piassa">Piassa</option>
            </Select>
          </FormField>
          <FormField label={LONG_AM} hint={LONG_AM} className="sm:col-span-2">
            <Textarea name="notes" />
          </FormField>
          <div className="sm:col-span-2">
            <Checkbox
              label="I agree to the loyalty program terms"
              description="Required to receive your card."
            />
            <Checkbox label={LONG_AM} error="You must accept to continue." />
          </div>
          <RadioGroup
            name="lang"
            legend="Language"
            value={plan}
            onValueChange={setPlan}
            options={[
              { value: "en", label: "English" },
              { value: "am", label: "አማርኛ", description: "Amharic" },
              { value: "other", label: "Other", disabled: true },
            ]}
          />
          <Switch
            checked={switchOn}
            onCheckedChange={setSwitchOn}
            label="Marketing messages"
            description="Opt in to offers from this business."
          />
        </form>
      </Section>

      <Section id="feedback" title="Alerts, badges and status">
        <Alert tone="info" title="Information">
          Your card works at every branch.
        </Alert>
        <Alert tone="success" title="Saved">
          Your changes were saved.
        </Alert>
        <Alert tone="warning" title="Reward expires soon">
          Use it before the end of the month.
        </Alert>
        <Alert tone="danger" title="This card is not valid" onDismiss={() => undefined}>
          Ask the customer to open their card again.
        </Alert>
        <Alert tone="warning">{LONG_AM}</Alert>
        <Row>
          <Badge tone="success">Active</Badge>
          <Badge tone="warning">Paused</Badge>
          <Badge tone="danger">Flagged</Badge>
          <Badge tone="neutral">Draft</Badge>
          <Badge tone="info">Info</Badge>
          <Badge tone="neutral">{LONG_WORD}</Badge>
        </Row>
        <Row>
          <StatusIndicator tone="success" label="Delivered" />
          <StatusIndicator tone="warning" label="Retrying" />
          <StatusIndicator tone="danger" label="Failed" />
        </Row>
      </Section>

      <Section id="progress" title="Progress and stamps">
        <ProgressBar label="Profile completeness" value={3} max={5} valueText="60%" />
        <Card>
          <StampProgress current={3} required={8} />
        </Card>
        <Card tone="highlight">
          <StampProgress current={8} required={8} rewardReady />
        </Card>
        <Card>
          <StampProgress current={34} required={40} />
        </Card>
      </Section>

      <Section id="cards" title="Cards and metrics">
        <div className="grid gap-4 sm:grid-cols-3">
          <MetricCard
            emphasis
            label="Monthly Returning Loyalty Customers"
            value="128"
            hint="October 2026"
          />
          <MetricCard label="New members" value="42" hint="Last 30 days" />
          <MetricCard label="Redemption rate" value="—" loading />
          <MetricCard label={LONG_AM} value="1,204" />
        </div>
        <Card>
          <CardHeader
            title="Card with header"
            description="Supporting description"
            action={<Button variant="secondary">Action</Button>}
          />
          <p>Body content sits here.</p>
        </Card>
      </Section>

      <Section id="tables" title="Table, search and pagination">
        <SearchField
          label="Search customers"
          placeholder="Name or phone"
          onSearch={(q) => setLast(`search: ${q || "(cleared)"}`)}
        />
        <Table label="Customers">
          <THead>
            <TR>
              <TH>Customer</TH>
              <TH>Status</TH>
              <TH>Progress</TH>
              <TH>{LONG_WORD}</TH>
            </TR>
          </THead>
          <TBody>
            <TR>
              <RowHeader>Abebe</RowHeader>
              <TD>
                <Badge tone="success">Active</Badge>
              </TD>
              <TD>3 of 8</TD>
              <TD>{LONG_AM}</TD>
            </TR>
            <TR>
              <RowHeader>Hana</RowHeader>
              <TD>
                <Badge tone="warning">Paused</Badge>
              </TD>
              <TD>8 of 8</TD>
              <TD>—</TD>
            </TR>
          </TBody>
        </Table>
        <Pagination
          hasPrevious
          hasNext
          from={26}
          to={50}
          total={120}
          onPrevious={() => setLast("previous")}
          onNext={() => setLast("next")}
        />
        <p aria-live="polite">Last action: {last}</p>
      </Section>

      <Section id="navigation" title="Tabs and menus">
        <Tabs
          label="Sample tabs"
          tabs={[
            { id: "one", label: "Overview", content: <p>Overview panel.</p> },
            { id: "two", label: "Branches", content: <p>Branches panel.</p> },
            { id: "three", label: LONG_WORD, content: <p>{LONG_AM}</p> },
            { id: "four", label: "Disabled", content: null, disabled: true },
          ]}
        />
        <DropdownMenu
          label="Actions"
          items={[
            { id: "edit", label: "Edit", onSelect: () => setLast("edit") },
            { id: "docs", label: "Open documentation", href: "/en" },
            { id: "off", label: "Unavailable", disabled: true },
            {
              id: "del",
              label: "Deactivate",
              tone: "danger",
              onSelect: () => setLast("deactivate"),
            },
          ]}
        />
      </Section>

      <Section id="overlays" title="Dialogs, drawers and toasts">
        <Row>
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Button variant="secondary" onClick={() => setDrawer(true)}>
            Open drawer
          </Button>
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            Confirm action
          </Button>
          <Button variant="danger" onClick={() => setStrongConfirm(true)}>
            Strong confirmation
          </Button>
        </Row>
        <Row>
          <Button
            variant="secondary"
            onClick={() =>
              toast.show({ tone: "success", title: "Saved", description: "Program updated." })
            }
          >
            Success toast
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.show({
                tone: "danger",
                title: "Could not save",
                description: "Check your connection and try again.",
              })
            }
          >
            Error toast
          </Button>
        </Row>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Dialog title"
          description="A short explanation of what this dialog is for."
          footer={<Button onClick={() => setDialog(false)}>Done</Button>}
        >
          <p>{LONG_AM}</p>
        </Dialog>
        <Drawer
          open={drawer}
          onClose={() => setDrawer(false)}
          title="Drawer title"
          footer={<Button onClick={() => setDrawer(false)}>Close drawer</Button>}
        >
          <p>Drawers hold longer forms and details without leaving the page.</p>
        </Drawer>
        <ConfirmDialog
          open={confirm}
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            await new Promise((resolve) => setTimeout(resolve, 600));
            setConfirm(false);
            toast.show({ tone: "success", title: "Confirmed" });
          }}
          title="Pause this program?"
          description="New customers will not be able to join until you activate it again."
          confirmLabel="Pause program"
        />
        <ConfirmDialog
          open={strongConfirm}
          onCancel={() => setStrongConfirm(false)}
          onConfirm={() => setStrongConfirm(false)}
          tone="danger"
          requirePhrase="REVERSE"
          title="Reverse this stamp?"
          description="The original stamp stays in the history; a reversal is added."
          confirmLabel="Reverse stamp"
        />
      </Section>

      <Section id="states" title="Empty, error, loading and confirmation">
        <EmptyState
          title="No customers yet"
          description="Share your join QR code so customers can sign up."
          action={<Button>Download QR poster</Button>}
        />
        <ErrorState
          title="We could not load this"
          description="Please try again."
          requestId="req_8f3a1c"
          onRetry={() => setLast("retry")}
        />
        <SkeletonGroup className="flex flex-col gap-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </SkeletonGroup>
        <Card>
          <ConfirmationScreen
            headingLevel="h3"
            title="You are in!"
            description="Your loyalty card is ready."
            actions={<Button size="lg">Add to wallet</Button>}
          />
        </Card>
      </Section>
    </div>
  );
}
