import * as React from 'react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@giaokhoa/ui/components/chart';
import { ToggleGroup, ToggleGroupItem } from '@giaokhoa/ui/components/toggle-group';

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartRange {
  value: string;
  label: string;
  count: number;
}

export function ChartAreaInteractive({
  title,
  description,
  seriesLabel,
  emptyText,
  data,
  ranges,
}: {
  title: string;
  description: string;
  seriesLabel: string;
  emptyText: string;
  data: ChartPoint[];
  ranges?: ChartRange[];
}) {
  const [range, setRange] = React.useState<string>(ranges?.[ranges.length - 1]?.value ?? '');
  const activeRange = ranges?.find((r) => r.value === range) ?? ranges?.[ranges.length - 1];
  const visible = activeRange ? data.slice(-activeRange.count) : data;
  const config: ChartConfig = {
    value: { label: seriesLabel, color: 'var(--primary)' },
  };
  return (
    <div className="px-4 lg:px-6">
      <Card className="@container/card">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
          {ranges && ranges.length > 1 ? (
            <CardAction>
              <ToggleGroup
                value={activeRange ? [activeRange.value] : []}
                onValueChange={(values) => {
                  const v = values[values.length - 1];
                  if (v) setRange(v);
                }}
                variant="outline"
                className="hidden *:data-[slot=toggle-group-item]:px-3 @[767px]/card:flex"
              >
                {ranges.map((r) => (
                  <ToggleGroupItem key={r.value} value={r.value}>
                    {r.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </CardAction>
          ) : null}
        </CardHeader>
        <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
          {visible.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            <ChartContainer config={config} className="aspect-auto h-62.5 w-full">
              <AreaChart data={visible} margin={{ left: 12, right: 12 }}>
                <defs>
                  <linearGradient id="dashboardChartFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                <Area
                  dataKey="value"
                  type="monotone"
                  fill="url(#dashboardChartFill)"
                  stroke="var(--color-value)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
