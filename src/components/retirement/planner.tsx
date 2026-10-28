import { useDeferredValue, useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Banknote,
  Building2,
  Calendar,
  ClipboardPaste,
  Copy,
  Download,
  HeartPulse,
  Landmark,
  Loader2,
  PiggyBank,
  Target,
  TrendingUp,
  Upload,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NumberField } from "@/components/retirement/number-field";
import { STATE_NAMES } from "@/lib/retirement/tax-tables";
import {
  ACCOUNT_LABELS,
  ACCOUNT_TYPES,
  CURRENT_YEAR,
  IRMAA_CAP_TIERS,
  type AccountSettings,
  type AccountType,
  type FilingStatus,
  type PlannerInputs,
  type ProjectionRow,
  catchUp,
  defaultInputs,
  displayedLimit,
  optimizationTargetAge,
  parsePlannerInputs,
  project,
  serializePlannerInputs,
  spendableWeight,
} from "@/lib/retirement/engine";
import type { PlanMessage } from "@/lib/retirement/optimize.worker";

const CHART_COLOR: Record<AccountType, string> = {
  rothIra: "hsl(var(--chart-1))",
  hsa: "hsl(var(--chart-2))",
  fourOhOneK: "hsl(var(--chart-4))",
  taxable: "hsl(var(--chart-5))",
};

const ACCOUNT_ICON: Record<AccountType, LucideIcon> = {
  rothIra: PiggyBank,
  hsa: HeartPulse,
  fourOhOneK: Building2,
  taxable: TrendingUp,
};

const BRACKETS = [10, 12, 22, 24, 32, 35, 37];

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function cents(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function compactMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function axisMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

function ageLabel(row: ProjectionRow, inputs: PlannerInputs): string {
  const mark = (age: number, dead: boolean) => (dead ? `(${age})` : String(age));
  const primary = mark(row.age, row.year > inputs.birthYear + inputs.longevityAge);
  if (row.spouseAge === null || inputs.spouseBirthYear === null) return primary;
  const spouse = mark(row.spouseAge, row.year > inputs.spouseBirthYear + inputs.spouseLongevityAge);
  return `${primary}/${spouse}`;
}

function NumberFieldRow(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  prefix?: string;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  testId?: string;
  useCommas?: boolean;
  commitOnBlur?: boolean;
  hint?: string;
}) {
  return <NumberField {...props} />;
}

function IrmaaCapSelect({
  filingStatus,
  value,
  onChange,
}: {
  filingStatus: FilingStatus;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const joint = filingStatus === "married";
  const selected = IRMAA_CAP_TIERS.find((tier) => tier.id === value);
  const selectedCap = selected ? (joint ? selected.jointCap : selected.singleCap) : null;
  const selectedMonthly = selected ? selected.partB + selected.partD : 0;
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">IRMAA Bracket Cap</Label>
      <Select value={value === null ? "none" : String(value)} onValueChange={(next) => onChange(next === "none" ? null : Number(next))}>
        <SelectTrigger data-testid="select-irmaa-bracket">
          <SelectValue placeholder="IRMAA bracket" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No IRMAA cap</SelectItem>
          {IRMAA_CAP_TIERS.map((tier) => {
            const cap = joint ? tier.jointCap : tier.singleCap;
            return (
              <SelectItem key={tier.id} value={String(tier.id)}>
                {tier.label} · ${cap.toLocaleString("en-US")}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {selectedCap === null
          ? "Conversions ignore Medicare IRMAA."
          : `Roth conversions stop at ${money(selectedCap)} ${joint ? "joint" : "single"} MAGI (${selectedMonthly === 0 ? "no surcharge" : `${cents(selectedMonthly)}/mo per person`}).`}
      </p>
    </div>
  );
}

function BracketSelect({
  value,
  onChange,
  testId,
}: {
  value: number;
  onChange: (value: number) => void;
  testId: string;
}) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger data-testid={testId}>
        <SelectValue placeholder="Tax Bracket" />
      </SelectTrigger>
      <SelectContent>
        {BRACKETS.map((rate) => (
          <SelectItem key={rate} value={String(rate)}>
            {rate}% Bracket
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SpendableWeightControl({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(() => Math.round(value * 100));
  useEffect(() => setDraft(Math.round(value * 100)), [value]);
  const detail =
    draft <= 0
      ? "A dollar still in a 401(k) or HSA counts as a dollar."
      : draft >= 100
        ? "A dollar still in a 401(k) or HSA counts only after the tax, penalty, and extra IRMAA to cash it out."
        : `Cash-out tax, penalty, and extra IRMAA count at ${draft}%.`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Total</span>
        <span>Spendable</span>
      </div>
      <Slider
        value={[draft]}
        min={0}
        max={100}
        step={1}
        onValueChange={([next]) => setDraft(next ?? 0)}
        onValueCommit={([next]) => onCommit((next ?? 0) / 100)}
        aria-label="Balance between total and spendable"
        data-testid="slider-spendable-weight"
      />
      <p className="text-[11px] leading-snug text-muted-foreground">{detail}</p>
    </div>
  );
}

function exactPlanStatus(inputs: PlannerInputs): string {
  const age = optimizationTargetAge(inputs);
  const weight = Math.round(spendableWeight(inputs) * 100);
  if (weight <= 0) return `Exact plan. Conversions maximize the total money left at age ${age}. A 401(k) or HSA is counted in full.`;
  if (weight >= 100) {
    return `Exact plan. Conversions maximize the spendable money left at age ${age}, after the tax to cash out pretax accounts.`;
  }
  return `Exact plan. Conversions maximize the money left at age ${age}, counting ${weight}% of the cost to cash out a 401(k) or HSA.`;
}

function AccountPanel({
  accountType,
  settings,
  onUpdate,
  birthYear,
  filingStatus,
  optimizeDistributions,
  onOptimizeDistributions,
  optimizeThroughAge,
  onOptimizeThroughAge,
  optimizeSpendableWeight,
  onOptimizeSpendableWeight,
}: {
  accountType: AccountType;
  settings: AccountSettings;
  onUpdate: <K extends keyof AccountSettings>(key: K, value: AccountSettings[K]) => void;
  birthYear: number;
  filingStatus: FilingStatus;
  optimizeDistributions?: boolean;
  onOptimizeDistributions?: (value: boolean) => void;
  optimizeThroughAge?: number;
  onOptimizeThroughAge?: (value: number) => void;
  optimizeSpendableWeight?: number;
  onOptimizeSpendableWeight?: (value: number) => void;
}) {
  const Icon = ACCOUNT_ICON[accountType];
  const limit = displayedLimit(accountType, birthYear, filingStatus);
  const contributionLabel = limit !== null ? `Annual Contribution ($${limit.toLocaleString("en-US")} limit)` : "Annual Contribution";
  const currentAge = CURRENT_YEAR - birthYear;

  return (
    <Card className={`transition-opacity duration-200 ${settings.enabled ? "" : "opacity-50"}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <CardTitle className="text-sm font-semibold">{ACCOUNT_LABELS[accountType]}</CardTitle>
        </div>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(checked) => onUpdate("enabled", checked)}
          data-testid={`switch-${accountType}-enabled`}
        />
      </CardHeader>
      {settings.enabled ? (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <NumberFieldRow
              label="Current Balance"
              prefix="$"
              value={settings.currentBalance}
              onChange={(value) => onUpdate("currentBalance", value)}
              min={0}
              useCommas
              testId={`input-${accountType}-balance`}
            />
            <NumberFieldRow
              label="Rate of Return"
              suffix="%"
              value={settings.rateOfReturn}
              onChange={(value) => onUpdate("rateOfReturn", value)}
              min={0}
              max={30}
              step={0.5}
              testId={`input-${accountType}-return`}
            />
          </div>
          <NumberFieldRow
            label={contributionLabel}
            prefix="$"
            value={settings.annualContribution}
            onChange={(value) => onUpdate("annualContribution", value)}
            min={0}
            useCommas
            testId={`input-${accountType}-contribution`}
          />
          {accountType === "fourOhOneK" ? (
            <>
              <NumberFieldRow
                label="Employer Match (grows 3%/yr)"
                prefix="$"
                value={settings.employerMatch}
                onChange={(value) => onUpdate("employerMatch", value)}
                min={0}
                step={500}
                useCommas
                testId={`input-${accountType}-employer-match`}
              />
              {onOptimizeDistributions ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="text-xs text-muted-foreground">Maximize ending money</Label>
                    <Switch
                      checked={optimizeDistributions === true}
                      onCheckedChange={onOptimizeDistributions}
                      data-testid="switch-optimize-distributions"
                    />
                  </div>
                  {optimizeDistributions ? (
                    <div className="space-y-1.5">
                      <NumberField
                        label="Maximize at age"
                        value={optimizeThroughAge ?? 90}
                        onChange={(value) => onOptimizeThroughAge?.(value)}
                        min={currentAge}
                        max={120}
                        commitOnBlur
                        testId="input-optimize-through-age"
                        hint="Primary age. The table still runs through longevity."
                      />
                      <SpendableWeightControl
                        value={optimizeSpendableWeight ?? 1}
                        onCommit={(value) => onOptimizeSpendableWeight?.(value)}
                      />
                      <p className="text-[11px] leading-snug text-muted-foreground">
                        Chooses each year's Roth conversion so the money left at this age is as large as possible. The slider sets whether a 401(k) or HSA dollar counts in full or after the cost to cash it out. A period that is off gets no conversion. A period that is on stops at that bracket and the IRMAA cap. Conversion tax is paid from the taxable account only when that switch is on; otherwise it is withheld from the conversion. After this age there are no more conversions. Required minimums and the withdrawals you entered still happen through longevity.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Pay Roth Conversion Taxes from Taxable Account</Label>
                <Switch
                  checked={settings.payConversionTaxFromTaxable}
                  onCheckedChange={(checked) => onUpdate("payConversionTaxFromTaxable", checked)}
                  data-testid="switch-pay-tax-from-taxable"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Pre-RMD Roth Conversions</Label>
                <Switch
                  checked={settings.preRmdConversion}
                  onCheckedChange={(checked) => onUpdate("preRmdConversion", checked)}
                  data-testid="switch-pre-rmd-conversion"
                />
              </div>
              {settings.preRmdConversion ? (
                <BracketSelect
                  value={settings.preRmdConversionBracketRate}
                  onChange={(value) => onUpdate("preRmdConversionBracketRate", value)}
                  testId="select-pre-rmd-bracket"
                />
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">RMD Roth Conversions</Label>
                <Switch
                  checked={settings.rmdConversion}
                  onCheckedChange={(checked) => onUpdate("rmdConversion", checked)}
                  data-testid="switch-rmd-conversion"
                />
              </div>
              {settings.rmdConversion ? (
                <BracketSelect
                  value={settings.rmdConversionBracketRate}
                  onChange={(value) => onUpdate("rmdConversionBracketRate", value)}
                  testId="select-rmd-bracket"
                />
              ) : null}
              {settings.preRmdConversion || settings.rmdConversion ? (
                <IrmaaCapSelect
                  filingStatus={filingStatus}
                  value={settings.irmaaBracket}
                  onChange={(value) => onUpdate("irmaaBracket", value)}
                />
              ) : null}
            </>
          ) : null}
          <NumberFieldRow
            label="Stop Contributing at Age"
            value={settings.stopContributionAge}
            onChange={(value) => onUpdate("stopContributionAge", value)}
            min={18}
            max={90}
            testId={`input-${accountType}-stop-age`}
          />
          <Separator />
          <NumberFieldRow
            label="Start Withdrawing at Age"
            value={settings.startWithdrawalAge}
            onChange={(value) => onUpdate("startWithdrawalAge", value)}
            min={18}
            max={90}
            testId={`input-${accountType}-withdraw-age`}
          />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">
                {settings.withdrawalIsPercentage ? "Withdrawal %" : "Annual Withdrawal"}
              </Label>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">Use %</Label>
                <Switch
                  checked={settings.withdrawalIsPercentage}
                  onCheckedChange={(checked) => onUpdate("withdrawalIsPercentage", checked)}
                  data-testid={`switch-${accountType}-withdrawal-pct`}
                />
              </div>
            </div>
            <NumberField
              value={settings.annualWithdrawal}
              onChange={(value) => onUpdate("annualWithdrawal", value)}
              min={0}
              max={settings.withdrawalIsPercentage ? 100 : undefined}
              step={settings.withdrawalIsPercentage ? 0.5 : 1000}
              prefix={settings.withdrawalIsPercentage ? undefined : "$"}
              suffix={settings.withdrawalIsPercentage ? "%" : undefined}
              testId={`input-${accountType}-withdrawal`}
            />
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

function enableMaximize(inputs: PlannerInputs): PlannerInputs {
  const seed = (accounts: PlannerInputs["accounts"]): PlannerInputs["accounts"] => {
    const current = accounts.fourOhOneK;
    if (current.preRmdConversion || current.rmdConversion) return accounts;
    return {
      ...accounts,
      fourOhOneK: {
        ...current,
        preRmdConversion: true,
        rmdConversion: true,
        preRmdConversionBracketRate: 37,
        rmdConversionBracketRate: 37,
        payConversionTaxFromTaxable: true,
      },
    };
  };
  return {
    ...inputs,
    optimizeDistributions: true,
    accounts: seed(inputs.accounts),
    spouseAccounts: seed(inputs.spouseAccounts),
  };
}

function AccountTabs({
  who,
  inputs,
  onChange,
}: {
  who: "primary" | "spouse";
  inputs: PlannerInputs;
  onChange: (next: PlannerInputs) => void;
}) {
  const bucket = who === "primary" ? "accounts" : "spouseAccounts";
  const settings = inputs[bucket];
  const prefix = who === "spouse" ? "spouse-" : "";
  const types: AccountType[] = who === "spouse" ? ["rothIra", "hsa", "fourOhOneK"] : [...ACCOUNT_TYPES];
  const birthYear = who === "primary" ? inputs.birthYear : (inputs.spouseBirthYear ?? inputs.birthYear);

  function update<K extends keyof AccountSettings>(type: AccountType, key: K, value: AccountSettings[K]) {
    onChange({
      ...inputs,
      [bucket]: {
        ...inputs[bucket],
        [type]: { ...inputs[bucket][type], [key]: value },
      },
    });
  }

  return (
    <Tabs defaultValue="rothIra" className="w-full">
      <TabsList className={`grid w-full ${who === "spouse" ? "grid-cols-3" : "grid-cols-4"}`}>
        <TabsTrigger value="rothIra" data-testid={`tab-${prefix}rothIra`} className="text-xs">
          Roth IRA
        </TabsTrigger>
        <TabsTrigger value="hsa" data-testid={`tab-${prefix}hsa`} className="text-xs">
          HSA
        </TabsTrigger>
        <TabsTrigger value="fourOhOneK" data-testid={`tab-${prefix}fourOhOneK`} className="text-xs">
          401(k)
        </TabsTrigger>
        {who === "primary" ? (
          <TabsTrigger value="taxable" data-testid={`tab-${prefix}taxable`} className="text-xs">
            Taxable
          </TabsTrigger>
        ) : null}
      </TabsList>
      {types.map((type) => (
        <TabsContent key={type} value={type}>
          <AccountPanel
            accountType={type}
            settings={settings[type]}
            onUpdate={(key, value) => update(type, key, value)}
            birthYear={birthYear}
            filingStatus={inputs.filingStatus}
            optimizeDistributions={who === "primary" && type === "fourOhOneK" ? inputs.optimizeDistributions : undefined}
            onOptimizeDistributions={
              who === "primary" && type === "fourOhOneK"
                ? (value) => onChange(value ? enableMaximize(inputs) : { ...inputs, optimizeDistributions: false })
                : undefined
            }
            optimizeThroughAge={who === "primary" && type === "fourOhOneK" ? inputs.optimizeThroughAge : undefined}
            onOptimizeThroughAge={
              who === "primary" && type === "fourOhOneK"
                ? (value) => onChange({ ...inputs, optimizeThroughAge: value })
                : undefined
            }
            optimizeSpendableWeight={who === "primary" && type === "fourOhOneK" ? inputs.optimizeSpendableWeight : undefined}
            onOptimizeSpendableWeight={
              who === "primary" && type === "fourOhOneK"
                ? (value) => onChange({ ...inputs, optimizeSpendableWeight: value })
                : undefined
            }
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function InputsForm({ inputs, onChange }: { inputs: PlannerInputs; onChange: (next: PlannerInputs) => void }) {
  const married = inputs.filingStatus === "married";
  const states = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

  function applyBirthYear(year: number) {
    const age = CURRENT_YEAR - year;
    const prevAge = CURRENT_YEAR - inputs.birthYear;
    const bases = {
      rothIra: 7500,
      hsa: inputs.filingStatus === "married" ? 4375 : 4400,
      fourOhOneK: 24500,
    } as const;
    const accounts = { ...inputs.accounts };
    for (const type of ["rothIra", "hsa", "fourOhOneK"] as const) {
      const previous = bases[type] + catchUp(type, prevAge);
      if (accounts[type].annualContribution === previous) {
        accounts[type] = { ...accounts[type], annualContribution: bases[type] + catchUp(type, age) };
      }
    }
    onChange({ ...inputs, birthYear: year, accounts });
  }

  function applySpouseBirthYear(year: number) {
    const age = CURRENT_YEAR - year;
    const prevAge = CURRENT_YEAR - (inputs.spouseBirthYear || inputs.birthYear);
    const bases = {
      rothIra: 7500,
      hsa: inputs.filingStatus === "married" ? 4375 : 4400,
      fourOhOneK: 24500,
    } as const;
    const spouseAccounts = { ...inputs.spouseAccounts };
    for (const type of ["rothIra", "hsa", "fourOhOneK"] as const) {
      const previous = bases[type] + catchUp(type, prevAge);
      if (spouseAccounts[type].annualContribution === previous) {
        spouseAccounts[type] = { ...spouseAccounts[type], annualContribution: bases[type] + catchUp(type, age) };
      }
    }
    onChange({ ...inputs, spouseBirthYear: year, spouseAccounts });
  }

  function applyRetirementYear(year: number) {
    const primaryAge = year - inputs.birthYear;
    const accounts = { ...inputs.accounts };
    for (const type of ["rothIra", "fourOhOneK", "taxable"] as const) {
      accounts[type] = { ...accounts[type], stopContributionAge: primaryAge, startWithdrawalAge: primaryAge };
    }
    accounts.hsa = { ...accounts.hsa, startWithdrawalAge: primaryAge };
    const spouseAge = inputs.spouseBirthYear ? year - inputs.spouseBirthYear : primaryAge;
    const spouseAccounts = { ...inputs.spouseAccounts };
    for (const type of ["rothIra", "fourOhOneK", "taxable"] as const) {
      spouseAccounts[type] = { ...spouseAccounts[type], stopContributionAge: spouseAge, startWithdrawalAge: spouseAge };
    }
    spouseAccounts.hsa = { ...spouseAccounts.hsa, startWithdrawalAge: spouseAge };
    onChange({ ...inputs, retirementYear: year, accounts, spouseAccounts });
  }

  function applyFiling(status: FilingStatus) {
    const next: PlannerInputs = {
      ...inputs,
      filingStatus: status,
      marriageYear: status === "married" ? inputs.marriageYear || CURRENT_YEAR : null,
      spouseBirthYear: status === "married" ? inputs.spouseBirthYear || 1960 : null,
    };
    if (status === "married") {
      next.accounts = { ...next.accounts, hsa: { ...next.accounts.hsa, annualContribution: 4375 } };
      next.spouseAccounts = { ...next.spouseAccounts, hsa: { ...next.spouseAccounts.hsa, annualContribution: 4375 } };
    } else {
      next.accounts = { ...next.accounts, hsa: { ...next.accounts.hsa, annualContribution: 4400 } };
    }
    onChange(next);
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Year of Birth"
              value={inputs.birthYear}
              onChange={applyBirthYear}
              min={1900}
              max={CURRENT_YEAR}
              commitOnBlur
              testId="input-birth-year"
              hint={`Age ${CURRENT_YEAR - inputs.birthYear}`}
            />
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Filing Status</Label>
              <Select value={inputs.filingStatus} onValueChange={(value) => applyFiling(value as FilingStatus)}>
                <SelectTrigger data-testid="select-filing-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="married">Married</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Retirement Year"
              value={inputs.retirementYear}
              onChange={applyRetirementYear}
              min={CURRENT_YEAR}
              max={CURRENT_YEAR + 80}
              commitOnBlur
              testId="input-retirement-year"
              hint={
                inputs.retirementYear <= CURRENT_YEAR
                  ? `${CURRENT_YEAR} or before · age ${inputs.retirementYear - inputs.birthYear}`
                  : `Age ${inputs.retirementYear - inputs.birthYear}`
              }
            />
            <NumberField
              label="Longevity (Primary)"
              value={inputs.longevityAge}
              onChange={(value) => onChange({ ...inputs, longevityAge: value })}
              min={50}
              max={120}
              commitOnBlur
              testId="input-longevity-age"
            />
          </div>
          {married ? (
            <div className="space-y-4 pt-2">
              <Separator />
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Marriage Year"
                  value={inputs.marriageYear || CURRENT_YEAR}
                  onChange={(year) => onChange({ ...inputs, marriageYear: year })}
                  min={CURRENT_YEAR}
                  max={CURRENT_YEAR + 80}
                  commitOnBlur
                  testId="input-marriage-year"
                  hint={inputs.marriageYear !== null && inputs.marriageYear <= CURRENT_YEAR ? `${CURRENT_YEAR} or before` : undefined}
                />
                <NumberField
                  label="Spouse Birth Year"
                  value={inputs.spouseBirthYear || inputs.birthYear}
                  onChange={applySpouseBirthYear}
                  min={1900}
                  max={CURRENT_YEAR}
                  commitOnBlur
                  testId="input-spouse-birth-year"
                  hint={inputs.spouseBirthYear !== null ? `Age ${CURRENT_YEAR - inputs.spouseBirthYear}` : undefined}
                />
              </div>
              <NumberField
                label="Longevity (Spouse)"
                value={inputs.spouseLongevityAge}
                onChange={(value) => onChange({ ...inputs, spouseLongevityAge: value })}
                min={50}
                max={120}
                commitOnBlur
                testId="input-spouse-longevity-age"
              />
            </div>
          ) : null}
          <div className="space-y-1.5 pt-2">
            <Separator />
            <NumberField
              label="Adjusted Gross Income"
              value={inputs.adjustedGrossIncome}
              onChange={(value) => onChange({ ...inputs, adjustedGrossIncome: value })}
              prefix="$"
              useCommas
              min={0}
              testId="input-agi"
            />
            <div className="flex items-start justify-between gap-3 pt-1">
              <div className="space-y-0.5">
                <Label htmlFor="checkbox-agi-first-year" className="text-xs text-muted-foreground">
                  Only the first year
                </Label>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Checked: this amount is used in {CURRENT_YEAR} only, and later years use $0. Unchecked: it is used every year.
                </p>
              </div>
              <Checkbox
                id="checkbox-agi-first-year"
                checked={inputs.agiFirstYearOnly}
                onCheckedChange={(checked) => onChange({ ...inputs, agiFirstYearOnly: checked === true })}
                data-testid="checkbox-agi-first-year"
                className="mt-0.5"
              />
            </div>
          </div>
          <div className="space-y-1.5 pt-2">
            <Separator />
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <NumberField
                label={married ? "Social Security (Primary)" : "Social Security"}
                value={inputs.socialSecurityIncome}
                onChange={(value) => onChange({ ...inputs, socialSecurityIncome: value })}
                prefix="$"
                useCommas
                min={0}
                testId="input-social-security"
              />
              <NumberField
                label="Start Age"
                value={inputs.socialSecurityStartAge}
                onChange={(value) => onChange({ ...inputs, socialSecurityStartAge: value })}
                min={62}
                max={70}
                commitOnBlur
                testId="input-ss-start-age"
              />
            </div>
            {married ? (
              <div className="grid grid-cols-[1fr_auto] items-end gap-3">
                <NumberField
                  label="Social Security (Spouse)"
                  value={inputs.spouseSocialSecurityIncome}
                  onChange={(value) => onChange({ ...inputs, spouseSocialSecurityIncome: value })}
                  prefix="$"
                  useCommas
                  min={0}
                  testId="input-spouse-social-security"
                />
                <NumberField
                  label="Start Age"
                  value={inputs.spouseSocialSecurityStartAge}
                  onChange={(value) => onChange({ ...inputs, spouseSocialSecurityStartAge: value })}
                  min={62}
                  max={70}
                  commitOnBlur
                  testId="input-spouse-ss-start-age"
                />
              </div>
            ) : null}
            <p className="text-[11px] leading-snug text-muted-foreground">
              Each amount is that person's annual check at the start age. The start year and the year of death count six months. After a death, the survivor receives the larger of their own check and the survivor benefit.
            </p>
          </div>
          <div className="space-y-1.5 pt-2">
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <Label className="whitespace-nowrap text-xs font-medium text-muted-foreground">State</Label>
              <Select value={inputs.state} onValueChange={(value) => onChange({ ...inputs, state: value })}>
                <SelectTrigger className="w-[180px]" data-testid="select-state">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {states.map(([code, name]) => (
                    <SelectItem key={code} value={code} data-testid={`option-state-${code}`}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      {married ? (
        <Tabs defaultValue="primary" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="primary" data-testid="tab-primary" className="text-sm">
              <User className="mr-1.5 h-4 w-4" />
              Primary
            </TabsTrigger>
            <TabsTrigger value="spouse" data-testid="tab-spouse" className="text-sm">
              <Users className="mr-1.5 h-4 w-4" />
              Spouse
            </TabsTrigger>
          </TabsList>
          <TabsContent value="primary">
            <AccountTabs who="primary" inputs={inputs} onChange={onChange} />
          </TabsContent>
          <TabsContent value="spouse">
            <AccountTabs who="spouse" inputs={inputs} onChange={onChange} />
          </TabsContent>
        </Tabs>
      ) : (
        <AccountTabs who="primary" inputs={inputs} onChange={onChange} />
      )}
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: { year: number; ages: string } }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const ages = row.ages;
  const total = payload.reduce((sum, item) => sum + (item.value || 0), 0);
  return (
    <div className="rounded-md border border-popover-border bg-popover p-3 shadow-lg">
      <p className="mb-2 text-xs font-semibold">
        {row.year} (Age {ages})
      </p>
      {payload.map((item) => (
        <div key={item.name} className="flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
            <span className="text-muted-foreground">{item.name}</span>
          </div>
          <span className="font-medium">{money(item.value || 0)}</span>
        </div>
      ))}
      <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs">
        <span className="font-semibold">Total</span>
        <span className="font-bold">{money(total)}</span>
      </div>
    </div>
  );
}

function GrowthChart({ rows, inputs }: { rows: ProjectionRow[]; inputs: PlannerInputs }) {
  const data = rows.map((row) => ({
    year: row.year,
    ages: ageLabel(row, inputs),
    label: `${row.year}`,
    [ACCOUNT_LABELS.fourOhOneK]: row.accounts.fourOhOneK.endBalance,
    [ACCOUNT_LABELS.rothIra]: row.accounts.rothIra.endBalance,
    [ACCOUNT_LABELS.hsa]: row.accounts.hsa.endBalance,
    [ACCOUNT_LABELS.taxable]: row.accounts.taxable.endBalance,
  }));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Portfolio Growth</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[260px] w-full sm:h-[350px] xl:h-[460px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={axisMoney} tick={{ fontSize: 10 }} width={55} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
              <Area type="monotone" dataKey={ACCOUNT_LABELS.fourOhOneK} stackId="1" stroke={CHART_COLOR.fourOhOneK} fill={CHART_COLOR.fourOhOneK} fillOpacity={0.6} />
              <Area type="monotone" dataKey={ACCOUNT_LABELS.rothIra} stackId="1" stroke={CHART_COLOR.rothIra} fill={CHART_COLOR.rothIra} fillOpacity={0.6} />
              <Area type="monotone" dataKey={ACCOUNT_LABELS.hsa} stackId="1" stroke={CHART_COLOR.hsa} fill={CHART_COLOR.hsa} fillOpacity={0.6} />
              <Area type="monotone" dataKey={ACCOUNT_LABELS.taxable} stackId="1" stroke={CHART_COLOR.taxable} fill={CHART_COLOR.taxable} fillOpacity={0.6} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function useColumnWidths() {
  const [widths, setWidths] = useState<number[] | null>(null);
  const widthsRef = useRef<number[] | null>(null);
  widthsRef.current = widths;

  function onResizeStart(index: number, event: PointerEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const headers = handle.closest("table")?.querySelectorAll("thead th");
    const base = widthsRef.current ?? (headers ? Array.from(headers).map((header) => header.getBoundingClientRect().width) : []);
    const startX = event.clientX;
    const startWidth = base[index] ?? 80;
    const pointerId = event.pointerId;
    function move(nextEvent: globalThis.PointerEvent) {
      if (nextEvent.pointerId !== pointerId) return;
      const next = base.slice();
      next[index] = Math.max(48, startWidth + nextEvent.clientX - startX);
      setWidths(next);
    }
    function end(nextEvent: globalThis.PointerEvent) {
      if (nextEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  return { widths, onResizeStart };
}

function ColumnHeader({
  label,
  title,
  align,
  bold,
  index,
  onResizeStart,
}: {
  label: string;
  title?: string;
  align: "left" | "right";
  bold?: boolean;
  index: number;
  onResizeStart: (index: number, event: PointerEvent<HTMLElement>) => void;
}) {
  return (
    <th
      title={title}
      style={{ zIndex: 40 - index }}
      className={`relative sticky top-0 h-12 whitespace-nowrap bg-card px-3 align-middle text-sm text-muted-foreground ${bold ? "font-bold" : "font-medium"} ${align === "left" ? "text-left" : "text-right"}`}
    >
      <span className="block truncate">{label}</span>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${label}`}
        className="absolute inset-y-0 right-0 z-30 w-3 cursor-col-resize touch-none hover:bg-primary/25"
        onPointerDown={(event) => onResizeStart(index, event)}
      />
    </th>
  );
}

function SummaryTable({ rows, inputs, year, onSelect }: { rows: ProjectionRow[]; inputs: PlannerInputs; year: number; onSelect: (year: number) => void }) {
  const columns: { label: string; title?: string; align: "left" | "right"; bold?: boolean }[] = [
    { label: "Year", align: "left" },
    { label: "Age", align: "left" },
    { label: "Roth IRA", align: "right" },
    { label: "HSA", align: "right" },
    { label: "401(k)", align: "right" },
    { label: "Taxable", align: "right" },
    { label: "Total", align: "right", bold: true },
    {
      label: "Spendable",
      align: "right",
      bold: true,
      title: "Total after the federal and state tax to cash out 401(k) and HSA balances, this year's IRMAA surcharge, and the extra IRMAA that cash-out would cause two years later. Roth and taxable count in full. A 401(k) cashed out before 60 also loses 10%, and an HSA spent on non-medical costs before 65 loses 20%.",
    },
    { label: "AGI", align: "right", title: "Adjusted gross income. Other income + taxable Social Security + RMD + Roth conversions." },
    { label: "Federal Tax", align: "right" },
    { label: "State Tax", align: "right" },
    { label: "Net Income", align: "right", title: "Other income + the full Social Security benefit + RMD + Roth conversions, minus federal and state income tax." },
    { label: "IRMAA", align: "right", title: "Annual Part B and Part D IRMAA surcharge for everyone on Medicare. Based on MAGI from two years earlier." },
  ];
  const { widths, onResizeStart } = useColumnWidths();
  return (
    <div className="h-[500px] overflow-auto">
      <table
        className={`caption-bottom text-sm ${widths ? "[&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap" : "w-full"}`}
        style={widths ? { tableLayout: "fixed", width: widths.reduce((sum, width) => sum + width, 0) } : undefined}
      >
        {widths ? (
          <colgroup>
            {widths.map((width, index) => (
              <col key={columns[index]?.label ?? index} style={{ width }} />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr className="border-b">
            {columns.map((column, index) => (
              <ColumnHeader key={column.label} {...column} index={index} onResizeStart={onResizeStart} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.year}
              data-testid={`row-summary-${row.year}`}
              aria-selected={row.year === year}
              onClick={() => onSelect(row.year)}
              className={`cursor-pointer border-b transition-colors ${row.year === year ? "bg-primary/10" : "hover:bg-muted/50"}`}
            >
              <td className="p-4 align-middle text-xs font-medium">{row.year}</td>
              <td className="p-4 align-middle text-xs">{ageLabel(row, inputs)}</td>
              <td className="p-4 text-right align-middle text-xs">{money(row.accounts.rothIra.endBalance)}</td>
              <td className="p-4 text-right align-middle text-xs">{money(row.accounts.hsa.endBalance)}</td>
              <td className="p-4 text-right align-middle text-xs">{money(row.accounts.fourOhOneK.endBalance)}</td>
              <td className="p-4 text-right align-middle text-xs">{money(row.accounts.taxable.endBalance)}</td>
              <td className="p-4 text-right align-middle text-xs font-bold">{money(row.totalBalance)}</td>
              <td className="p-4 text-right align-middle text-xs font-bold" data-testid={`text-spendable-${row.year}`}>
                {money(row.liquidBalance)}
              </td>
              <td className="p-4 text-right align-middle text-xs" data-testid={`text-agi-${row.year}`}>
                {money(row.taxSummary.grossIncome)}
              </td>
              <td className="p-4 text-right align-middle text-xs" data-testid={`text-federal-tax-${row.year}`}>
                {money(row.taxSummary.federalTax)}
              </td>
              <td className="p-4 text-right align-middle text-xs" data-testid={`text-state-tax-${row.year}`}>
                {money(row.taxSummary.stateTax)}
              </td>
              <td className="p-4 text-right align-middle text-xs" data-testid={`text-net-${row.year}`}>
                {money(row.taxSummary.annualNet)}
              </td>
              <td className="p-4 text-right align-middle text-xs" data-testid={`text-irmaa-${row.year}`}>
                {row.taxSummary.irmaa.annualFee === null ? "—" : cents(row.taxSummary.irmaa.annualFee)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountTable({ rows, inputs, accountType }: { rows: ProjectionRow[]; inputs: PlannerInputs; accountType: AccountType }) {
  const columns = ["Year", "Age", "Starting Balance", "Contribution", "Withdrawal", "Growth", "Ending Balance"];
  const { widths, onResizeStart } = useColumnWidths();
  return (
    <div className="h-[500px] overflow-auto">
      <table
        className={`caption-bottom text-sm ${widths ? "[&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap" : "w-full"}`}
        style={widths ? { tableLayout: "fixed", width: widths.reduce((sum, width) => sum + width, 0) } : undefined}
      >
        {widths ? (
          <colgroup>
            {widths.map((width, index) => (
              <col key={columns[index] ?? index} style={{ width }} />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr className="border-b">
            {columns.map((heading, index) => (
              <ColumnHeader key={heading} label={heading} align={index < 2 ? "left" : "right"} index={index} onResizeStart={onResizeStart} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const account = row.accounts[accountType];
            return (
              <tr key={row.year} data-testid={`row-${accountType}-${row.year}`} className="border-b transition-colors hover:bg-muted/50">
                <td className="p-4 align-middle text-xs font-medium">{row.year}</td>
                <td className="p-4 align-middle text-xs">{ageLabel(row, inputs)}</td>
                <td className="p-4 text-right align-middle text-xs">{money(account.startBalance)}</td>
                <td className="p-4 text-right align-middle text-xs text-green-600 dark:text-green-400">
                  {account.contribution > 0 ? money(account.contribution) : "-"}
                </td>
                <td className="p-4 text-right align-middle text-xs text-red-500 dark:text-red-400">
                  {account.withdrawal > 0 ? money(account.withdrawal) : "-"}
                </td>
                <td className="p-4 text-right align-middle text-xs text-muted-foreground">
                  {account.growth !== 0 ? money(account.growth) : "-"}
                </td>
                <td className="p-4 text-right align-middle text-xs font-semibold">{money(account.endBalance)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FourOhOneKTable({ rows, inputs, year, onSelect }: { rows: ProjectionRow[]; inputs: PlannerInputs; year: number; onSelect: (year: number) => void }) {
  const headers: { label: string; title?: string; align: "left" | "right" }[] = [
    { label: "Year", align: "left" },
    { label: "Age", align: "left" },
    { label: "Starting Balance", align: "right" },
    { label: "Contribution", align: "right" },
    { label: "Withdrawal", align: "right", title: "RMD, Roth conversions, and any scheduled withdrawal." },
    { label: "RMD", align: "right", title: "Required minimum distribution from the 401(k)." },
    { label: "Growth", align: "right" },
    { label: "Ending Balance", align: "right" },
    { label: "IRMAA Income", align: "right", title: "MAGI Medicare uses: other income + taxable Social Security + RMD + Roth conversions." },
  ];
  const { widths, onResizeStart } = useColumnWidths();
  return (
    <div className="h-[500px] overflow-auto">
      <table
        className={`caption-bottom text-sm ${widths ? "[&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap" : "w-full min-w-[960px]"}`}
        style={widths ? { tableLayout: "fixed", width: widths.reduce((sum, width) => sum + width, 0) } : undefined}
      >
        {widths ? (
          <colgroup>
            {widths.map((width, index) => (
              <col key={headers[index]?.label ?? index} style={{ width }} />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr className="border-b">
            {headers.map((heading, index) => (
              <ColumnHeader key={heading.label} {...heading} index={index} onResizeStart={onResizeStart} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const account = row.accounts.fourOhOneK;
            const tax = row.taxSummary;
            return (
              <tr
                key={row.year}
                data-testid={`row-fourOhOneK-${row.year}`}
                aria-selected={row.year === year}
                onClick={() => onSelect(row.year)}
                className={`cursor-pointer border-b transition-colors ${row.year === year ? "bg-primary/10" : "hover:bg-muted/50"}`}
              >
                <td className="px-3 py-3 align-middle text-xs font-medium">{row.year}</td>
                <td className="px-3 py-3 align-middle text-xs">{ageLabel(row, inputs)}</td>
                <td className="px-3 py-3 text-right align-middle text-xs">{money(account.startBalance)}</td>
                <td className="px-3 py-3 text-right align-middle text-xs text-green-600 dark:text-green-400">
                  {account.contribution > 0 ? money(account.contribution) : "-"}
                </td>
                <td className="px-3 py-3 text-right align-middle text-xs text-red-500 dark:text-red-400">
                  {account.withdrawal > 0 ? money(account.withdrawal) : "-"}
                </td>
                <td className="px-3 py-3 text-right align-middle text-xs" data-testid={`text-rmd-${row.year}`}>
                  {tax.rmdAmount > 0 ? money(tax.rmdAmount) : "-"}
                </td>
                <td className="px-3 py-3 text-right align-middle text-xs text-muted-foreground">
                  {account.growth !== 0 ? money(account.growth) : "-"}
                </td>
                <td className="px-3 py-3 text-right align-middle text-xs font-semibold">{money(account.endBalance)}</td>
                <td className="px-3 py-3 text-right align-middle text-xs" data-testid={`text-irmaa-income-${row.year}`}>
                  {money(tax.irmaaMagi)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function IrmaaBreakout({ row }: { row: ProjectionRow | undefined }) {
  if (!row) return null;
  const tax = row.taxSummary;
  const fee = tax.irmaa;
  const monthly = fee.partBMonthly + fee.partDMonthly;
  return (
    <div className="mt-4 rounded-md border p-4" data-testid="panel-irmaa-breakout">
      <div className="mb-3">
        <p className="text-sm font-semibold">How IRMAA was calculated</p>
        <p className="max-w-xl text-xs text-muted-foreground">
          Select a year in the table. The fee in a given year uses MAGI from two years earlier. The 2028 surcharge is based on 2026 IRMAA income. Brackets are the 2026 CMS amounts and are not inflated.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium">IRMAA income in {row.year}</p>
          <dl className="mt-2 space-y-1 text-xs">
            <BreakoutLine label="Other income" value={money(tax.agi)} />
            <BreakoutLine label="Taxable Social Security" value={money(tax.taxableSS)} />
            <BreakoutLine label="RMD" value={money(tax.rmdAmount)} />
            <BreakoutLine label="Roth conversions" value={money(tax.conversionAmount)} />
            <BreakoutLine label="IRMAA MAGI" value={money(tax.irmaaMagi)} strong />
          </dl>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            This MAGI sets the {row.year + 2} premium. Adjusted gross income uses the same pieces, and it matches IRMAA income here because tax-exempt interest is not included. Net income ({money(tax.annualNet)}) starts from the full Social Security benefit ({money(tax.annualGross)}), then subtracts federal and state income tax.
          </p>
        </div>
        <div>
          <p className="text-xs font-medium">IRMAA fee paid in {row.year}</p>
          <p className="mt-2 text-xs">
            Filing status for {row.year} is {row.filingStatus === "married" ? "Married" : "Single"}.
          </p>
          {fee.enrollees === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Nobody is 65 yet, so Medicare IRMAA is {money(0)}.
              {fee.lookbackMagi !== null ? ` ${fee.lookbackYear} MAGI was ${money(fee.lookbackMagi)}.` : ""}
            </p>
          ) : fee.annualFee === null ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {row.year} uses {fee.lookbackYear} MAGI, and {fee.lookbackYear} is before this projection, so the surcharge is not calculated.
            </p>
          ) : (
            <div className="mt-2 space-y-1 text-xs">
              <p>
                Based on {fee.lookbackYear} MAGI of {money(fee.lookbackMagi ?? 0)}
                {fee.lookbackFiling === "married" ? " (married filing jointly)" : " (single)"}.
              </p>
              <p>
                Bracket: {fee.tierLabel}. Part B surcharge {cents(fee.partBMonthly)}/mo plus Part D surcharge {cents(fee.partDMonthly)}/mo
                {monthly === 0 ? " (standard premium, no IRMAA)" : ""}.
              </p>
              <p>
                {fee.enrollees} {fee.enrollees === 1 ? "person" : "people"} on Medicare (age 65 or older) × 12 × {cents(monthly)} ={" "}
                <span className="font-semibold">{cents(fee.annualFee)}</span> for the year.
              </p>
              <p className="text-[11px] leading-snug text-muted-foreground">
                This is the income-related surcharge only, on top of the $202.90 standard Part B premium, charged per person.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BreakoutLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "border-t pt-1 font-semibold" : ""}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function BracketTaxList({ slices }: { slices: { rate: number; income: number; tax: number }[] }) {
  if (slices.length === 0) {
    return <p className="mt-1 text-xs text-muted-foreground">No federal tax. The deduction covers this income.</p>;
  }
  return (
    <dl className="mt-1 space-y-1 text-xs">
      {slices.map((slice) => (
        <BreakoutLine key={slice.rate} label={`${Math.round(slice.rate * 100)}% on ${money(slice.income)}`} value={money(slice.tax)} />
      ))}
    </dl>
  );
}

function sameBrackets(
  left: { rate: number; income: number; tax: number }[],
  right: { rate: number; income: number; tax: number }[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((slice, index) => {
    const other = right[index];
    return other !== undefined && slice.rate === other.rate && Math.round(slice.income) === Math.round(other.income) && Math.round(slice.tax) === Math.round(other.tax);
  });
}

function penaltySentence(label: string, age: number, balance: number, penalty: number, freeAt: number, rate: number): string {
  if (balance <= 0) return "";
  if (penalty > 0) return ` ${label}: age ${age} is under ${freeAt}, so ${Math.round(rate * 100)}% is ${money(penalty)}.`;
  return ` ${label}: age ${age} is ${freeAt} or older, so there is no ${Math.round(rate * 100)}% penalty.`;
}

function SpendableBreakout({ row }: { row: ProjectionRow | undefined }) {
  if (!row) return null;
  const part = row.spendable;
  const penalty401 = part.penalty401Primary + part.penalty401Spouse;
  const penaltyHsa = part.penaltyHsaPrimary + part.penaltyHsaSpouse;
  const spouse = row.spouseAge !== null;
  return (
    <div className="mt-4 rounded-md border p-4" data-testid="panel-spendable-breakout">
      <div className="mb-3">
        <p className="text-sm font-semibold">How the spendable amount was calculated</p>
        <p className="text-sm font-semibold" data-testid="text-spendable-year">
          {row.year}
        </p>
        <p className="max-w-xl text-xs text-muted-foreground">
          Select a year in the table. Roth and taxable balances count in full. Cashing out the 401(k) and HSA still in the accounts adds the extra federal and state tax, this year's IRMAA surcharge, and the extra IRMAA that cash-out would cause two years later. A 401(k) cashed out before 60 also loses 10%. An HSA spent on anything other than medical care before 65 loses 20%.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium">Balances at the end of {row.year}</p>
          <dl className="mt-2 space-y-1 text-xs">
            <BreakoutLine label="Roth IRA" value={money(part.roth)} />
            <BreakoutLine label="Taxable" value={money(part.taxable)} />
            <BreakoutLine label={spouse ? "401(k), you" : "401(k)"} value={money(part.fourOhOneKPrimary)} />
            {spouse ? <BreakoutLine label="401(k), spouse" value={money(part.fourOhOneKSpouse)} /> : null}
            <BreakoutLine label={spouse ? "HSA, you" : "HSA"} value={money(part.hsaPrimary)} />
            {spouse ? <BreakoutLine label="HSA, spouse" value={money(part.hsaSpouse)} /> : null}
            <BreakoutLine label="Total" value={money(part.face)} strong />
          </dl>
        </div>
        <div>
          <p className="text-xs font-medium">Cost of cashing out what is left</p>
          <dl className="mt-2 space-y-1 text-xs">
            <BreakoutLine label="Federal tax on this year's income" value={money(part.federalBefore)} />
            <BreakoutLine label="Federal tax if 401(k) and HSA are cashed out" value={money(part.federalAfter)} />
            <BreakoutLine label="State tax on this year's income" value={money(part.stateBefore)} />
            <BreakoutLine label="State tax if 401(k) and HSA are cashed out" value={money(part.stateAfter)} />
            <BreakoutLine label="Extra income tax" value={money(part.extraTax)} />
            <BreakoutLine label="401(k) early-withdrawal penalty" value={money(penalty401)} />
            <BreakoutLine label="HSA non-medical penalty" value={money(penaltyHsa)} />
            <BreakoutLine label={`IRMAA due in ${row.year}`} value={part.irmaaThisYear === null ? "—" : money(part.irmaaThisYear)} />
            {part.irmaaCashoutYear !== null ? (
              <>
                <BreakoutLine label={`IRMAA in ${part.irmaaCashoutYear} from this year's income`} value={money(part.irmaaFeeBefore)} />
                <BreakoutLine label={`IRMAA in ${part.irmaaCashoutYear} if 401(k) and HSA are cashed out`} value={money(part.irmaaFeeAfter)} />
              </>
            ) : null}
            <BreakoutLine label="Extra IRMAA from cashing out" value={money(part.irmaaFromCashout)} />
            <BreakoutLine label="Spendable" value={money(part.spendable)} strong />
          </dl>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            {money(part.face)} − {money(part.extraTax)} extra tax
            {part.irmaaThisYear !== null && part.irmaaThisYear > 0 ? ` − ${money(part.irmaaThisYear)} IRMAA` : ""}
            {part.irmaaFromCashout > 0 ? ` − ${money(part.irmaaFromCashout)} later IRMAA` : ""}
            {penalty401 > 0 ? ` − ${money(penalty401)} 401(k) penalty` : ""}
            {penaltyHsa > 0 ? ` − ${money(penaltyHsa)} HSA penalty` : ""} = {money(part.spendable)}. This year's income tax stays in the year's net income. It is not taken off the ending balances again.
            {part.irmaaThisYear === null ? ` IRMAA for ${row.year} depends on a year before this projection, so it is not subtracted.` : ""}
            {part.irmaaCashoutYear === null
              ? " Cashing out does not add a later IRMAA surcharge, because nobody in the projection is on Medicare two years later."
              : ` The extra IRMAA is the ${part.irmaaCashoutYear} surcharge from this year's MAGI if the remaining 401(k) and HSA were withdrawn, minus the surcharge from this year's income alone.`}
            {penaltySentence("401(k)", row.age, part.fourOhOneKPrimary, part.penalty401Primary, 60, 0.1)}
            {spouse ? penaltySentence("spouse 401(k)", row.spouseAge ?? 0, part.fourOhOneKSpouse, part.penalty401Spouse, 60, 0.1) : ""}
            {penaltySentence("HSA", row.age, part.hsaPrimary, part.penaltyHsaPrimary, 65, 0.2)}
            {spouse ? penaltySentence("spouse HSA", row.spouseAge ?? 0, part.hsaSpouse, part.penaltyHsaSpouse, 65, 0.2) : ""}
          </p>
        </div>
      </div>
      <div className="mt-4 border-t pt-3" data-testid="panel-bracket-tax">
        <p className="text-xs font-medium">Federal tax paid in each bracket</p>
        <p className="text-xs font-medium" data-testid="text-bracket-year">
          {row.year}
        </p>
        <p className="mt-1 text-xs" data-testid="text-bracket-filing">
          {row.filingStatus === "married"
            ? "These taxes are calculated for Married Filing Jointly."
            : "These taxes are calculated for a Single filing."}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          Ordinary income after the deduction, and the federal tax charged at that rate. The amounts add up to the federal tax lines above.
        </p>
        {sameBrackets(part.federalBracketsBefore, part.federalBracketsAfter) ? (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground">This year's income</p>
            <BracketTaxList slices={part.federalBracketsBefore} />
          </div>
        ) : (
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">This year's income</p>
              <BracketTaxList slices={part.federalBracketsBefore} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">If the 401(k) and HSA are cashed out</p>
              <BracketTaxList slices={part.federalBracketsAfter} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectionTable({ rows, inputs }: { rows: ProjectionRow[]; inputs: PlannerInputs }) {
  const firstFeeYear = rows.find((row) => row.taxSummary.irmaa.enrollees > 0 && row.taxSummary.irmaa.annualFee !== null)?.year;
  const [spendableYear, setSpendableYear] = useState(rows[0]?.year ?? CURRENT_YEAR);
  const [irmaaYear, setIrmaaYear] = useState(firstFeeYear ?? rows.find((row) => row.age >= 65)?.year ?? rows[0]?.year ?? CURRENT_YEAR);
  const spendableRow = rows.find((row) => row.year === spendableYear) ?? rows[0];
  const irmaaRow = rows.find((row) => row.year === irmaaYear) ?? rows[0];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Year-by-Year Projection</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="summary">
          <TabsList className="mb-3 grid w-full grid-cols-5">
            <TabsTrigger value="summary" data-testid="tab-summary" className="text-xs">
              Summary
            </TabsTrigger>
            <TabsTrigger value="rothIra" data-testid="tab-table-rothIra" className="text-xs">
              Roth IRA
            </TabsTrigger>
            <TabsTrigger value="hsa" data-testid="tab-table-hsa" className="text-xs">
              HSA
            </TabsTrigger>
            <TabsTrigger value="fourOhOneK" data-testid="tab-table-401k" className="text-xs">
              401(k)
            </TabsTrigger>
            <TabsTrigger value="taxable" data-testid="tab-table-taxable" className="text-xs">
              Taxable
            </TabsTrigger>
          </TabsList>
          <TabsContent value="summary">
            <SummaryTable rows={rows} inputs={inputs} year={spendableRow?.year ?? spendableYear} onSelect={setSpendableYear} />
            <SpendableBreakout row={spendableRow} />
          </TabsContent>
          {ACCOUNT_TYPES.map((type) => (
            <TabsContent key={type} value={type}>
              {type === "fourOhOneK" ? (
                <>
                  <FourOhOneKTable rows={rows} inputs={inputs} year={irmaaRow?.year ?? irmaaYear} onSelect={setIrmaaYear} />
                  <IrmaaBreakout row={irmaaRow} />
                </>
              ) : (
                <AccountTable rows={rows} inputs={inputs} accountType={type} />
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: LucideIcon }) {
  return (
    <Card>
      <CardContent className="pb-4 pt-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground" data-testid={`text-stat-label-${label}`}>
              {label}
            </p>
            <p className="text-lg font-bold tracking-tight" data-testid={`text-stat-value-${label}`}>
              {value}
            </p>
            <p className="text-xs text-muted-foreground">{detail}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stats({ rows, inputs }: { rows: ProjectionRow[]; inputs: PlannerInputs }) {
  if (rows.length === 0) return null;
  const peak = rows.reduce((best, row) => (row.totalBalance > best.totalBalance ? row : best), rows[0]);
  const retireAge = inputs.retirementYear - inputs.birthYear;
  const atRetirement = rows.find((row) => row.age === retireAge);
  const balance = atRetirement?.totalBalance || 0;
  const dividends = (atRetirement ? atRetirement.accounts.taxable.endBalance : 0) * 0.02;
  const years = Math.max(0, retireAge - (CURRENT_YEAR - inputs.birthYear));
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard label="At Retirement" value={compactMoney(balance)} detail={`Age ${retireAge}`} icon={Target} />
      <StatCard
        label="Peak Portfolio Value"
        value={compactMoney(peak.totalBalance)}
        detail={`At age ${peak.age} (${peak.year})`}
        icon={TrendingUp}
      />
      <StatCard label="Dividends at Retirement" value={`$${Math.round(dividends / 1000)}k`} detail="2% of taxable balance" icon={Banknote} />
      <StatCard label="Years to Retirement" value={`${years}`} detail={`Retiring at age ${retireAge}`} icon={Calendar} />
    </div>
  );
}

function PlanTransfer({ inputs, onLoad }: { inputs: PlannerInputs; onLoad: (next: PlannerInputs) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const baseline = useRef(serializePlannerInputs(inputs));
  const [status, setStatus] = useState<string | null>(null);

  function loadText(text: string, source: string) {
    let next: PlannerInputs;
    try {
      next = parsePlannerInputs(text);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Couldn't load that plan.");
      return;
    }
    const nextText = serializePlannerInputs(next);
    const currentText = serializePlannerInputs(inputs);
    if (currentText !== baseline.current && nextText !== currentText) {
      const ok = window.confirm("Are you sure? This will replace the plan on this page.");
      if (!ok) {
        setStatus("Load canceled");
        return;
      }
    }
    baseline.current = nextText;
    onLoad(next);
    setStatus(`Loaded from ${source}`);
  }

  function saveFile() {
    const blob = new Blob([serializePlannerInputs(inputs)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "retirement-plan.json";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("Saved retirement-plan.json");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(serializePlannerInputs(inputs));
      setStatus("Copied to clipboard");
    } catch {
      setStatus("Couldn't copy. Check clipboard permission.");
    }
  }

  async function paste() {
    try {
      loadText(await navigator.clipboard.readText(), "the clipboard");
    } catch {
      setStatus("Couldn't read the clipboard.");
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadText(String(reader.result ?? ""), file.name);
    reader.onerror = () => setStatus("Couldn't read that file.");
    reader.readAsText(file);
  }

  const buttonClass =
    "inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium hover:bg-muted";

  return (
    <div className="ml-auto flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1.5">
        <a
          href="/maximize-my-retirement-guide.pdf"
          download="Maximize My Retirement User's Guide.pdf"
          className={buttonClass}
          data-testid="link-user-guide"
        >
          <Download className="h-3.5 w-3.5" />
          Guide
        </a>
        <button type="button" className={buttonClass} onClick={copy} data-testid="button-copy-plan" aria-label="Copy plan">
          <Copy className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Copy</span>
        </button>
        <button type="button" className={buttonClass} onClick={() => void paste()} data-testid="button-paste-plan" aria-label="Paste plan">
          <ClipboardPaste className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Paste</span>
        </button>
        <button type="button" className={buttonClass} onClick={saveFile} data-testid="button-save-plan" aria-label="Save plan">
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Save</span>
        </button>
        <button type="button" className={buttonClass} onClick={() => fileRef.current?.click()} data-testid="button-load-plan" aria-label="Load plan">
          <Upload className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Load</span>
        </button>
      </div>
      {status ? (
        <p className="text-[11px] text-muted-foreground" data-testid="text-plan-transfer-status">
          {status}
        </p>
      ) : null}
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} data-testid="input-load-plan" />
    </div>
  );
}

export function RetirementPlanner() {
  const [inputs, setInputs] = useState<PlannerInputs>(() => defaultInputs());
  const deferredInputs = useDeferredValue(inputs);
  const planInputs = inputs.optimizeDistributions ? deferredInputs : inputs;
  const planKey = serializePlannerInputs(planInputs);
  const [rows, setRows] = useState<ProjectionRow[]>(() => project(defaultInputs()));
  const [solving, setSolving] = useState(false);
  const [exact, setExact] = useState(true);
  const maximizing = inputs.optimizeDistributions && (solving || inputs !== deferredInputs);

  useEffect(() => {
    if (!planInputs.optimizeDistributions) {
      setRows(project(planInputs));
      setSolving(false);
      setExact(true);
      return;
    }
    let cancel = false;
    setSolving(true);
    const worker = new Worker(new URL("../../lib/retirement/optimize.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<PlanMessage>) => {
      if (cancel) return;
      if (event.data.type === "progress" && event.data.rows.length > 0) setRows(event.data.rows);
      if (event.data.type === "done") {
        if (event.data.rows.length > 0) setRows(event.data.rows);
        setExact(event.data.exact);
        setSolving(false);
        worker.terminate();
      }
    };
    worker.postMessage(planInputs);
    return () => {
      cancel = true;
      worker.terminate();
    };
  }, [planKey]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/80 backdrop-blur-sm lg:sticky lg:top-0 lg:z-50">
        <div className="mx-auto flex w-full max-w-[2200px] flex-col gap-2 px-3 py-2 lg:px-8 lg:py-3">
          <div className="flex items-center gap-2 lg:gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 lg:h-9 lg:w-9">
              <Landmark className="h-4 w-4 text-primary lg:h-5 lg:w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-sm font-bold tracking-tight lg:text-base" data-testid="text-app-title">
                Maximize My Retirement
              </h1>
              <p className="hidden truncate text-xs text-muted-foreground lg:block">Maximize your retirement savings across multiple account types</p>
            </div>
            <PlanTransfer inputs={inputs} onLoad={setInputs} />
          </div>
          {inputs.optimizeDistributions ? (
            <div
              className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                maximizing
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : exact
                    ? "border-green-600/40 bg-green-600/10 text-foreground dark:border-green-500/40 dark:bg-green-500/10"
                    : "border-amber-500/40 bg-amber-500/10 text-foreground"
              }`}
              data-testid="text-optimize-status"
              role="status"
              aria-live="polite"
            >
              {maximizing ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" /> : null}
              <span>
                {maximizing
                  ? "Maximizing. The table updates as a better plan is found."
                  : exact
                    ? exactPlanStatus(inputs)
                    : "Showing the best plan found. The exact search did not finish, so this may not be the proven maximum."}
              </span>
            </div>
          ) : null}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[2200px] px-3 py-4 lg:px-8 lg:py-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="space-y-6">
            <InputsForm inputs={inputs} onChange={setInputs} />
          </aside>
          <div className="space-y-6">
            <Stats rows={rows} inputs={inputs} />
            <GrowthChart rows={rows} inputs={inputs} />
            <ProjectionTable rows={rows} inputs={inputs} />
          </div>
        </div>
      </main>
    </div>
  );
}
