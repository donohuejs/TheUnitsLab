import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PRODUCT_NAME } from "@/lib/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: PRODUCT_NAME,
  description: "Experiment, analyze, and improve your sports performance with Vials.",
  icons: {
    icon: "/brand/the-units-lab-mark.png",
    apple: "/brand/the-units-lab-mark.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
