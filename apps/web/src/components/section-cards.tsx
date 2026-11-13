import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@giaokhoa/ui/components/card';
import { Skeleton } from '@giaokhoa/ui/components/skeleton';

export interface StatCard {
  id: string;
  label: string;
  value: string;
  footer?: string;
  loading?: boolean;
}

export function SectionCards({ cards }: { cards: StatCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {cards.map((card) => (
        <Card key={card.id} className="@container/card" data-testid={`stat-card-${card.id}`}>
          <CardHeader>
            <CardDescription>{card.label}</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {card.loading ? <Skeleton className="h-8 w-20" /> : card.value}
            </CardTitle>
          </CardHeader>
          {card.loading ? (
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <Skeleton className="h-4 w-28" />
            </CardFooter>
          ) : card.footer ? (
            <CardFooter className="flex-col items-start gap-1.5 text-sm">
              <div className="text-muted-foreground">{card.footer}</div>
            </CardFooter>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
