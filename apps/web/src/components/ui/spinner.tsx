import { RiLoader4Line } from "@remixicon/react";
import { cn } from "@/lib/utils";

function Spinner({
  className,
  ...props
}: React.ComponentProps<typeof RiLoader4Line>) {
  return (
    <RiLoader4Line
      aria-label="Loading"
      className={cn("animate-spin", className)}
      role="status"
      {...props}
    />
  );
}

export { Spinner };
