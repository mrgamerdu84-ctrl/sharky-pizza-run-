import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  to?: string;
  children?: ReactNode;
};

export function Link({ to, children, onClick, ...props }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) {
      event.preventDefault();
    }
  };

  return (
    <a href={to ?? './'} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}

export function createFileRoute(path: string) {
  return (config: Record<string, unknown>) => ({ path, ...config });
}
