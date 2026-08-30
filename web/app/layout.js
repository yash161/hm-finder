import "./globals.css";

export const metadata = {
  title: "HM Finder — AI-Powered Hiring Manager Discovery",
  description: "Find hiring managers for any job and generate personalized outreach messages using AI.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
