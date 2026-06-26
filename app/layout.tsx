import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RHEAS Intern AI Chat",
  description: "Project-specific AI chat for HealthMap internship coding and artifacts.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
