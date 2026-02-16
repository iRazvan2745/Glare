import { Toaster as SileoToaster } from "sileo";

type ToasterProps = React.ComponentProps<typeof SileoToaster> & {
  richColors?: boolean;
};

const Toaster = ({
  richColors: _richColors,
  position = "bottom-right",
  options,
  ...props
}: ToasterProps) => {
  const mergedOptions = {
    fill: "var(--popover)",
    ...options,
    styles: {
      button: "border border-border bg-muted text-foreground hover:bg-muted/80",
      description: "text-foreground/80",
      title: "text-foreground",
      ...options?.styles,
    },
  };

  return <SileoToaster position={position} options={mergedOptions} {...props} />;
};

export { Toaster };
