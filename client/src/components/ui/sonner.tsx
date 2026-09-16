import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      richColors
      toastOptions={{
        classNames: {
          toast: "!border-[#DDE2EE] !bg-white !text-[#11183D] !shadow-lg",
          title: "!text-[#11183D]",
          description: "!text-[#667085]",
        },
      }}
      style={
        {
          "--normal-bg": "#ffffff",
          "--normal-text": "#11183D",
          "--normal-border": "#DDE2EE",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
