import type { ReactNode } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@giaokhoa/ui/components/alert';

export interface ErrorAlertProps {
  title?: ReactNode;
  variant?: 'default' | 'destructive';
  className?: string;
  descriptionClassName?: string;
  role?: string;
  children?: ReactNode;
}

export function ErrorAlert({ title, variant, className, descriptionClassName, role, children }: ErrorAlertProps) {
  return (
    <Alert variant={variant} className={className} {...(role ? { role } : {})}>
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      {children ? <AlertDescription className={descriptionClassName}>{children}</AlertDescription> : null}
    </Alert>
  );
}
