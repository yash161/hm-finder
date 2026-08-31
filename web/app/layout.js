import "./globals.css";

export const metadata = {
  title: "HM Finder — AI-Powered Hiring Manager Discovery",
  description: "Find hiring managers for any job and generate personalized outreach messages using AI.",
};

const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem("hm-finder-theme");
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
