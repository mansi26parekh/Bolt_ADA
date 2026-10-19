import type { TourStep } from "../components/TourOverlay";

export const landingTourSteps: TourStep[] = [
  {
    selector: "[data-tour='landing-brand']",
    title: "Welcome to ADA Scanner",
    body: "This is your accessibility scanning dashboard. We'll walk you through every feature so you can start scanning your websites in no time. Let's begin!",
    placement: "bottom",
  },
  {
    selector: "[data-tour='scan-url-input']",
    title: "Enter Your Website URL",
    body: "Type any website address here (e.g. example.com). The first time you scan a URL, ADA Scanner automatically creates a project folder for that website so all its future scans stay grouped together in your sidebar.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='scan-submit-btn']",
    title: "Start the Scan",
    body: "Click this button to begin scanning. The crawler will discover linked pages on your site and run 15+ accessibility checks on each page it finds.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='retest-section']",
    title: "Re-test Previous Sites",
    body: "If you've scanned websites before, select \"Yes\" here to see a list of your previously scanned projects and jump straight back to their results.",
    placement: "top",
  },
  {
    selector: "[data-tour='features-section']",
    title: "What We Check",
    body: "ADA Scanner covers image alt text, form labels, heading hierarchy, color contrast, ARIA validity, and many more WCAG success criteria — all in one scan.",
    placement: "top",
  },
  {
    selector: "[data-tour='how-it-works']",
    title: "How It Works",
    body: "The process is simple: enter your URL, we crawl and scan your site, then you review a detailed report with violations categorized by severity and WCAG criteria.",
    placement: "top",
  },
];

export const scanningTourSteps: TourStep[] = [
  {
    selector: "[data-tour='scan-progress']",
    title: "Scan In Progress",
    body: "Your website is being crawled and scanned page by page. The progress bar shows how many pages have been checked out of the total discovered.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='scan-id']",
    title: "Scan Identifier",
    body: "Each scan gets a unique ID. You can share this ID with your team to reference a specific scan run.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='scan-pagelist']",
    title: "Live Page Discovery",
    body: "As pages are discovered and scanned, they appear here in real time. Green checkmarks mean a page passed all checks; warning icons mean issues were found.",
    placement: "top",
  },
];

export const sidebarTourSteps: TourStep[] = [
  {
    selector: "[data-tour='sidebar-logo']",
    title: "Your Project Sidebar",
    body: "This sidebar appears once you've started scanning. Each website you scan gets its own project folder here, so you can easily switch between sites.",
    placement: "right",
  },
  {
    selector: "[data-tour='new-scan-btn']",
    title: "Start a New Scan",
    body: "Click \"New Scan\" here at any time to go back to the landing page and scan a different website. A new project folder will be created automatically.",
    placement: "right",
  },
  {
    selector: "[data-tour='projects-list']",
    title: "Your Project Folders",
    body: "Every website you scan appears here as a project folder. Click any project to open its latest scan results. Hover over a project and click the X to delete it.",
    placement: "right",
  },
];

export const resultsTourSteps: TourStep[] = [
  {
    selector: "[data-tour='results-new-scan']",
    title: "Back to New Scan",
    body: "Click here to go back and start scanning a different website. Your current results stay saved in the sidebar project folder.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='results-url']",
    title: "Scanned Website",
    body: "This shows the URL of the website currently being displayed. You can verify which site you're reviewing at a glance.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='hero-summary']",
    title: "Scan Summary Banner",
    body: "This banner gives you an at-a-glance overview: how many issues were found, how many pages passed, and how many need fixes. The color reflects severity.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='severity-cards']",
    title: "Severity Breakdown",
    body: "These cards show violations grouped by impact: critical, serious, moderate, and minor. Click any card to filter the results below by that severity level.",
    placement: "top",
  },
  {
    selector: "[data-tour='page-filter']",
    title: "All Pages vs. Affected Pages",
    body: "Toggle between \"All Pages\" to see every scanned page, or \"Affected Pages\" to see only pages with violations. Use \"Affected Pages\" to focus on what needs fixing.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='rescan-btn']",
    title: "Re-scan Website",
    body: "Click \"Re-scan\" to run a fresh scan of the same website. This is useful after you've made fixes and want to verify your accessibility score has improved.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='share-btn']",
    title: "Share Report Menu",
    body: "Click \"Share Report\" to open a menu with two options: export a developer-friendly report, or copy a shareable link to send to colleagues.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='share-btn']",
    title: "Export Report Option",
    body: "Inside the Share Report menu, choose \"Export Report\" to download a detailed developer-friendly report. This is great for sharing with your engineering team or keeping an audit trail.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='schedule-btn']",
    title: "Schedule ADA Scans",
    body: "Click \"Schedule Scan\" to set up automatic recurring scans. You can choose a specific date, monthly, or every 3 months. The report gets emailed to you automatically when each scan completes.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='pages-list']",
    title: "Page-by-Page Results",
    body: "Each scanned page appears here. Click a page to expand it and see every violation on that page, grouped by rule. Each violation shows the exact HTML element and a recommended fix.",
    placement: "top",
  },
  {
    selector: "[data-tour='inspect-hint']",
    title: "Inspect & Fix Violations",
    body: "Inside each expanded violation, hover over \"Fix\" for a step-by-step recommendation, and click \"Inspect\" to preview the element in context. This is where you'll spend most of your time.",
    placement: "center",
  },
];

export const scheduleModalTourSteps: TourStep[] = [
  {
    selector: "[data-tour='schedule-datetime']",
    title: "Pick Date & Time",
    body: "Choose when you want the scan to run. The date and time must be in the future. This is when your website will be automatically scanned.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='schedule-recurrence']",
    title: "Choose Recurrence",
    body: "Select \"Specific Date\" for a one-time scan, \"Monthly\" to scan every month, or \"Every 3 Months\" for quarterly audits. One-time scans run once and then stop automatically.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='schedule-email']",
    title: "Report Email Address",
    body: "Enter the email address where you want the scan report sent. When each scheduled scan completes, a summary report is automatically emailed here.",
    placement: "bottom",
  },
  {
    selector: "[data-tour='schedule-submit']",
    title: "Confirm Schedule",
    body: "Click here to save your schedule. The scan will run automatically at the chosen time and you'll receive the report by email. You can cancel or edit schedules anytime from the results page.",
    placement: "top",
  },
];
