import "./globals.css";
export const metadata = {
  title: "Cadence — melody, understood",
  description: "An attentive workspace for finding the notes in your voice.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
