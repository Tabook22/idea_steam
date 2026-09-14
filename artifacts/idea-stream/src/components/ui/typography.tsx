import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { VariantProps, cva } from "class-variance-authority"

import { cn } from "@/lib/utils"

const typographyVariants = cva("text-foreground", {
  variants: {
    variant: {
      h1: "scroll-m-20 text-4xl font-extrabold tracking-tight lg:text-5xl font-serif",
      h2: "scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight first:mt-0 font-serif",
      h3: "scroll-m-20 text-2xl font-semibold tracking-tight font-serif",
      h4: "scroll-m-20 text-xl font-semibold tracking-tight font-serif",
      p: "leading-7 [&:not(:first-child)]:mt-6",
      blockquote: "mt-6 border-l-2 pl-6 italic font-serif",
      list: "my-6 ml-6 list-disc [&>li]:mt-2",
      inlineCode: "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
      lead: "text-xl text-muted-foreground",
      large: "text-lg font-semibold",
      small: "text-sm font-medium leading-none",
      muted: "text-sm text-muted-foreground",
    },
  },
  defaultVariants: {
    variant: "p",
  },
})

export interface TypographyProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof typographyVariants> {
  asChild?: boolean
}

function Typography({
  className,
  variant,
  asChild = false,
  ...props
}: TypographyProps) {
  const Comp = asChild ? Slot : getComponentForVariant(variant)
  return (
    <Comp
      className={cn(typographyVariants({ variant, className }))}
      {...props}
    />
  )
}

function getComponentForVariant(variant: VariantProps<typeof typographyVariants>["variant"]) {
  switch (variant) {
    case "h1": return "h1"
    case "h2": return "h2"
    case "h3": return "h3"
    case "h4": return "h4"
    case "p": return "p"
    case "blockquote": return "blockquote"
    case "list": return "ul"
    case "inlineCode": return "code"
    case "lead": return "p"
    case "large": return "div"
    case "small": return "small"
    case "muted": return "p"
    default: return "p"
  }
}

export { Typography, typographyVariants }