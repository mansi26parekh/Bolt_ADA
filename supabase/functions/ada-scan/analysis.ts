// ─── Accessibility analysis engine (DOM-based, WAVE-aligned) ───
// Uses linkedom for proper DOM tree traversal instead of regex matching.
// Implements a shared ACCNAME computation engine and WAVE rule precedence
// so one element is never reported under multiple criteria.

import { parseHTML } from "npm:linkedom@0.18.13";

export interface Violation {
  impact: string; category: string; ruleId: string; title: string;
  description: string; helpUrl: string; element: string; selector: string;
}

export const VIOLATION_TITLES: Record<string, string> = {
  "image-alt":             "Missing image alternative text",
  "image-alt-empty-link":  "Linked image missing alternative text",
  "input-image-alt":       "Image button missing alternative text",
  "html-lang-valid":       "Missing or invalid page language",
  "document-title":        "Missing or empty page title",
  "label":                 "Missing form label",
  "label-empty":           "Empty form label",
  "multiple-labels":       "Multiple form labels",
  "button-name":           "Empty button",
  "link-name":             "Empty link",
  "empty-heading":         "Empty heading",
  "th-empty":              "Empty table header",
  "aria-reference-broken": "Broken ARIA reference",
  "skip-link-broken":      "Broken skip link",
  "label-title":           "Title-only form label",
  "select-missing-label":  "Missing select label",
};

function makeViolation(
  ruleId: string, impact: string, category: string,
  description: string, helpUrl: string, element: string, selector: string
): Violation {
  return { impact, category, ruleId, title: VIOLATION_TITLES[ruleId] || "Accessibility issue",
    description, helpUrl, element, selector };
}

// ─── Helpers ───

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function truncate(str: string, maxLen: number): string {
  return str.length <= maxLen ? str : str.slice(0, maxLen - 3) + "...";
}

function cssEscape(str: string): string {
  return str.replace(/([^\w-])/g, "\\$1");
}

// ─── Main analysis function ───

export function analyzeAccessibility(
  html: string, _pageUrl: string
): { violations: Violation[]; passCount: number } {
  const violations: Violation[] = [];
  let passCount = 0;

  // Parse HTML into a proper DOM tree
  let document: any;
  try {
    const parsed = parseHTML(html);
    document = parsed.document;
    if (!document || !document.querySelectorAll) {
      console.error("linkedom parse: no document returned");
      return { violations, passCount: 0 };
    }
  } catch (err) {
    console.error("linkedom parse error:", String(err));
    return { violations, passCount: 0 };
  }

  // Remove script, style, noscript — WAVE evaluates the rendered DOM.
  // Comments are removed too so they don't interfere with text extraction.
  document.querySelectorAll("script, style, noscript").forEach((el: any) => el.remove());

  // ─── Build helper maps (single pass) ───

  const elementById = new Map<string, any>();
  document.querySelectorAll("[id]").forEach((el: any) => {
    const id = el.getAttribute("id");
    if (id && !elementById.has(id)) elementById.set(id, el);
  });
  const allIds = new Set(elementById.keys());

  const labelByForId = new Map<string, any>();
  const labelForCounts: Record<string, number> = {};
  document.querySelectorAll("label[for]").forEach((label: any) => {
    const forId = label.getAttribute("for");
    if (!forId) return;
    if (!labelByForId.has(forId)) labelByForId.set(forId, label);
    labelForCounts[forId] = (labelForCounts[forId] || 0) + 1;
  });

  // Controls wrapped inside <label> (implicit association)
  const controlInLabel = new Set<any>();
  document.querySelectorAll("label").forEach((label: any) => {
    label.querySelectorAll("input, select, textarea").forEach((ctrl: any) => {
      controlInLabel.add(ctrl);
    });
  });

  // ─── ACCNAME engine (WAI-ARIA Accessible Name Computation, simplified to match WAVE) ───

  function getSubtreeText(el: any): string {
    let text = "";
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        text += node.textContent || "";
      } else if (node.nodeType === 1) {
        const child = node;
        // Skip aria-hidden subtrees — they contribute nothing to the
        // accessible name per WAI-ARIA spec and WAVE behavior.
        if (child.getAttribute && child.getAttribute("aria-hidden") === "true") continue;
        // Skip presentation/none — their children are exposed directly.
        const tag = child.tagName;
        if (tag === "IMG") {
          const alt = child.getAttribute("alt");
          if (alt && alt.trim()) text += alt;
        } else if (tag === "SVG") {
          // aria-hidden SVGs contribute no name
          if (child.getAttribute("aria-hidden") === "true") continue;
          const al = child.getAttribute("aria-label");
          if (al && al.trim()) { text += al; continue; }
          const t = child.querySelector("title");
          if (t && t.textContent && t.textContent.trim()) text += t.textContent;
        } else if (tag === "BR") {
          text += " ";
        } else {
          text += getSubtreeText(child);
        }
      }
    }
    return text;
  }

  function getTextContent(el: any): string {
    return decodeEntities(getSubtreeText(el)).trim();
  }

  /**
   * Compute the accessible name for any element following WAI-ARIA ACCNAME
   * precedence (simplified to match WAVE's implementation):
   *   1. aria-labelledby → text content of referenced element(s)
   *   2. aria-label → attribute value
   *   3. Element-specific: img/input[image] → alt; input[button/submit/reset] → value
   *   4. Subtree text content (links, buttons, headings, etc.)
   *      Includes alt from child images and title/aria-label from child SVGs
   *   5. title → attribute value (lowest precedence, WAVE accepts as fallback)
   */
  function computeAccName(el: any): string {
    // 1. aria-labelledby
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const parts: string[] = [];
      for (const id of labelledby.trim().split(/\s+/)) {
        const ref = elementById.get(id);
        if (ref) {
          const t = getTextContent(ref);
          if (t) parts.push(t);
        }
      }
      if (parts.length > 0) return parts.join(" ").trim();
    }

    // 2. aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 3. Element-specific naming
    const tag = el.tagName;
    if (tag === "IMG") {
      const alt = el.getAttribute("alt");
      if (alt !== null && alt.trim()) return alt.trim();
    }
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") {
        const val = el.getAttribute("value");
        if (val && val.trim()) return val.trim();
      }
      if (type === "image") {
        const alt = el.getAttribute("alt");
        if (alt !== null && alt.trim()) return alt.trim();
      }
    }

    // 4. Subtree text content
    const text = getTextContent(el);
    if (text) return text;

    // 5. title (fallback)
    const title = el.getAttribute("title");
    if (title && title.trim()) return title.trim();

    return "";
  }

  // ─── Visibility / semantics helpers ───

  function isAriaHidden(el: any): boolean {
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
    let p = el.parentElement;
    while (p) {
      if (p.getAttribute && p.getAttribute("aria-hidden") === "true") return true;
      p = p.parentElement;
    }
    return false;
  }

  function isPresentation(el: any): boolean {
    const role = el.getAttribute("role");
    return role === "presentation" || role === "none";
  }

  /**
   * Detect framework template directives (Vue, Alpine, React JSX expressions).
   * These are not real rendered elements — WAVE evaluates the DOM after JS
   * execution so it never sees them. Since we parse static HTML, we must skip them.
   */
  function isTemplateDirective(el: any): boolean {
    for (const attr of Array.from(el.attributes)) {
      const n = attr.name;
      if (n.startsWith(":") || n.startsWith("v-") || n.startsWith("x-") || n.startsWith("@") ||
          n.startsWith(":") || n === "v-html" || n === "v-text" || n === "v-if" ||
          n === "v-show" || n === "v-bind" || n === "v-for" || n.startsWith("{{")) {
        return true;
      }
    }
    return false;
  }

  // ─── Stable locator builder ───
  // Builds a CSS selector that uniquely identifies an element in the DOM.
  // Priority: #id > tag + distinguishing attrs > nth-of-type path

  function buildLocator(el: any): string {
    const id = el.getAttribute("id");
    if (id) return `#${cssEscape(id)}`;

    const parts: string[] = [];
    let cur: any = el;
    while (cur && cur.tagName && cur.tagName.toLowerCase() !== "html") {
      let sel = cur.tagName.toLowerCase();

      const type = cur.getAttribute("type");
      if (type) sel += `[type="${type}"]`;
      const name = cur.getAttribute("name");
      if (name) sel += `[name="${name}"]`;
      const href = cur.getAttribute("href");
      if (href) sel += `[href="${href.length > 60 ? href.slice(0, 60) + "..." : href}"]`;
      const role = cur.getAttribute("role");
      if (role) sel += `[role="${role}"]`;
      const ariaLabel = cur.getAttribute("aria-label");
      if (ariaLabel) sel += `[aria-label="${ariaLabel.length > 40 ? ariaLabel.slice(0, 40) + "..." : ariaLabel}"]`;
      const placeholder = cur.getAttribute("placeholder");
      if (placeholder) sel += `[placeholder="${placeholder}"]`;
      const title = cur.getAttribute("title");
      if (title) sel += `[title="${title.length > 40 ? title.slice(0, 40) + "..." : title}"]`;
      const src = cur.getAttribute("src");
      if (src && (cur.tagName === "IMG" || cur.tagName === "INPUT")) {
        sel += `[src="${src.length > 60 ? src.slice(0, 60) + "..." : src}"]`;
      }
      const value = cur.getAttribute("value");
      if (value && (cur.tagName === "INPUT" || cur.tagName === "BUTTON")) {
        sel += `[value="${value.length > 40 ? value.slice(0, 40) + "..." : value}"]`;
      }

      // Add nth-of-type for disambiguation when siblings share the same tag
      const parent = cur.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((s: any) => s.tagName === cur.tagName);
        if (sameTag.length > 1) {
          sel += `:nth-of-type(${sameTag.indexOf(cur) + 1})`;
        }
      }

      parts.unshift(sel);
      cur = cur.parentElement;
    }

    return parts.length > 0 ? parts.join(" > ") : (el.tagName || "unknown").toLowerCase();
  }

  function elHtml(el: any): string {
    return truncate(el.outerHTML || "", 2000);
  }

  // ─── Form label helpers ───

  function controlHasLabel(ctrl: any): boolean {
    if (controlInLabel.has(ctrl)) return true;
    const ariaLabel = ctrl.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return true;
    const labelledby = ctrl.getAttribute("aria-labelledby");
    if (labelledby) {
      if (labelledby.trim().split(/\s+/).some((id: string) => {
        const ref = elementById.get(id);
        return ref && getTextContent(ref).length > 0;
      })) return true;
    }
    const ctrlId = ctrl.getAttribute("id");
    if (ctrlId && labelByForId.has(ctrlId)) return true;
    const title = ctrl.getAttribute("title");
    if (title && title.trim()) return true;
    return false;
  }

  function labelTitleOnlyCheck(ctrl: any): boolean {
    const title = ctrl.getAttribute("title");
    if (!title || !title.trim()) return false;
    if (controlInLabel.has(ctrl)) return false;
    const ariaLabel = ctrl.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return false;
    const labelledby = ctrl.getAttribute("aria-labelledby");
    if (labelledby) {
      if (labelledby.trim().split(/\s+/).some((id: string) => {
        const ref = elementById.get(id);
        return ref && getTextContent(ref).length > 0;
      })) return false;
    }
    const ctrlId = ctrl.getAttribute("id");
    if (ctrlId && labelByForId.has(ctrlId)) return false;
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  //  WAVE-aligned rules with precedence
  //  Processing order ensures one element → at most one violation
  // ═══════════════════════════════════════════════════════════════

  // Track elements already reported to prevent double-reporting
  const reportedImages = new Set<any>();   // images reported as alt_link_missing

  // ── Rule: Empty Link (WAVE-style link-name) ──
  //
  // A link is flagged as Empty Link when it has NO meaningful accessible name,
  // determined by the full WAI-ARIA accessible name computation:
  //   1. aria-labelledby → text of referenced element(s)
  //   2. aria-label → attribute value
  //   3. Subtree text (including alt from child images, SVG aria-label/title)
  //      — aria-hidden descendants are skipped
  //   4. title → non-empty title attribute (WAVE accepts as fallback)
  //
  // This subsumes the former "image-alt-empty-link" branch: a linked image
  // with missing/empty alt AND no other link name is reported as a single
  // Empty Link violation, matching WAVE. The inner image is marked so it is
  // not double-reported by the standalone image-alt rule.
  //
  // The DOM parser automatically handles Vue/React template directives:
  //   <a :href="..."> has attribute ":href" not "href", so a[href] won't match it.

  document.querySelectorAll("a[href]").forEach((link: any) => {
    if (isTemplateDirective(link)) { passCount++; return; }
    if (isAriaHidden(link)) { passCount++; return; }

    const name = computeAccName(link);
    if (name) {
      passCount++;
      return;
    }

    // No accessible name — mark inner images so they aren't double-reported
    // by the standalone image-alt rule (one element → one violation).
    link.querySelectorAll("img").forEach((img: any) => {
      if (!isPresentation(img) && !isAriaHidden(img)) reportedImages.add(img);
    });

    violations.push(makeViolation("link-name", "serious", "WCAG 4.1.2",
      "Link has no accessible name. Screen readers cannot convey this link's purpose to the user.",
      "https://wave.webaim.org/api/references#e_link_empty",
      elHtml(link), buildLocator(link)));
  });

  // ── Rule 2: Missing alt text (standalone images, not already reported as linked) ──
  document.querySelectorAll("img").forEach((img: any) => {
    if (reportedImages.has(img)) return;  // Already handled by alt_link_missing
    if (isPresentation(img)) return;
    if (isAriaHidden(img)) { passCount++; return; }

    if (!img.hasAttribute("alt")) {
      // Check if aria-label/aria-labelledby/title provides a name
      const name = computeAccName(img);
      if (!name) {
        violations.push(makeViolation("image-alt", "serious", "WCAG 1.1.1",
          "Image is missing an alt attribute. Screen readers cannot convey the image's content or purpose to non-sighted users.",
          "https://wave.webaim.org/api/references#e_alt_missing",
          elHtml(img), buildLocator(img)));
      } else {
        passCount++;
      }
    } else {
      // Has alt (even empty "" is valid for decorative images)
      passCount++;
    }
  });

  // ── Rule 5: Empty buttons ──
  // <button> elements
  document.querySelectorAll("button").forEach((btn: any) => {
    if (isAriaHidden(btn)) { passCount++; return; }
    if (isTemplateDirective(btn)) { passCount++; return; }
    const name = computeAccName(btn);
    if (!name) {
      violations.push(makeViolation("button-name", "critical", "WCAG 4.1.2",
        "Button has no accessible text. Screen readers will announce it as an unnamed button, making it impossible for users to understand its purpose.",
        "https://wave.webaim.org/api/references#e_button_empty",
        elHtml(btn), buildLocator(btn)));
    } else {
      passCount++;
    }
  });

  // <input type="button|submit|reset"> elements
  document.querySelectorAll("input").forEach((input: any) => {
    const type = (input.getAttribute("type") || "text").toLowerCase();
    if (type === "image") {
      // Input image — check alt
      if (isAriaHidden(input)) { passCount++; return; }
      if (!input.hasAttribute("alt")) {
        violations.push(makeViolation("input-image-alt", "serious", "WCAG 1.1.1",
          "Image input button is missing an alt attribute. Screen readers cannot identify this button's purpose.",
          "https://wave.webaim.org/api/references#e_alt_input_missing",
          elHtml(input), buildLocator(input)));
      } else {
        passCount++;
      }
      return;
    }
    if (!["button", "submit", "reset"].includes(type)) return;
    if (isAriaHidden(input)) { passCount++; return; }
    const name = computeAccName(input);
    if (!name) {
      violations.push(makeViolation("button-name", "critical", "WCAG 4.1.2",
        "Button input does not have an accessible name. Provide a non-empty value attribute, an associated label, aria-label, or aria-labelledby.",
        "https://wave.webaim.org/api/references#e_button_empty",
        elHtml(input), buildLocator(input)));
    } else {
      passCount++;
    }
  });

  // ── Rule 1: Missing form labels ──
  document.querySelectorAll("input, select, textarea").forEach((ctrl: any) => {
    const tag = ctrl.tagName;
    const type = (ctrl.getAttribute("type") || "text").toLowerCase();
    // Skip types that don't need labels (handled above or not text inputs)
    if (tag === "INPUT" && ["hidden", "submit", "reset", "button", "image"].includes(type)) return;
    if (isAriaHidden(ctrl)) { passCount++; return; }

    if (controlHasLabel(ctrl)) {
      passCount++;
      if (labelTitleOnlyCheck(ctrl)) {
        violations.push(makeViolation("label-title", "moderate", "WCAG 1.3.1",
          "Form control is labeled only with a title attribute. While screen readers may read the title as a fallback, a proper <label>, aria-label, or aria-labelledby is recommended.",
          "https://wave.webaim.org/api/references#a_label_title",
          elHtml(ctrl), buildLocator(ctrl)));
      }
    } else {
      if (tag === "SELECT") {
        violations.push(makeViolation("select-missing-label", "moderate", "WCAG 1.3.1",
          "Select (dropdown) element does not have an associated label. Screen reader users cannot identify the purpose of this control.",
          "https://wave.webaim.org/api/references#a_select_missing_label",
          elHtml(ctrl), buildLocator(ctrl)));
      } else {
        violations.push(makeViolation("label", "serious", "WCAG 1.3.1",
          "Form input does not have an associated label. Users relying on screen readers or voice control cannot determine what information to enter.",
          "https://wave.webaim.org/api/references#e_label_missing",
          elHtml(ctrl), buildLocator(ctrl)));
      }
    }
  });

  // ── Rule 6: Broken skip links ──
  document.querySelectorAll("a[href]").forEach((link: any) => {
    const href = link.getAttribute("href") || "";
    const hashMatch = href.match(/^#(.+)$/);
    if (!hashMatch) return;
    const targetId = hashMatch[1];

    const linkText = getTextContent(link).toLowerCase();
    const isSkipLink = /skip|jump|bypass|main content|navigation/i.test(linkText) ||
                       isEarlyInDocument(link);

    if (isSkipLink && !allIds.has(targetId)) {
      violations.push(makeViolation("skip-link-broken", "serious", "WCAG 2.4.1",
        `Skip link points to "#${targetId}" which does not exist on this page. Users who rely on skip links to bypass navigation are stranded.`,
        "https://wave.webaim.org/api/references#e_skip_target_missing",
        elHtml(link), buildLocator(link)));
    }
  });

  function isEarlyInDocument(el: any): boolean {
    const allEls = Array.from(document.querySelectorAll("*"));
    const idx = allEls.indexOf(el);
    return idx >= 0 && idx < 80;
  }

  // ─── Additional rules (DOM-based) ───

  // HTML lang
  const htmlEl = document.querySelector("html");
  if (htmlEl && !htmlEl.hasAttribute("lang")) {
    violations.push(makeViolation("html-lang-valid", "serious", "WCAG 3.1.1",
      "The <html> element does not have a lang attribute. Screen readers use this to select the correct voice and pronunciation engine.",
      "https://wave.webaim.org/api/references#e_lang_missing", "<html>", "html"));
  } else if (htmlEl) {
    passCount++;
  }

  // Document title
  const titleEl = document.querySelector("title");
  if (!titleEl || !titleEl.textContent || !titleEl.textContent.trim()) {
    violations.push(makeViolation("document-title", "serious", "WCAG 2.4.2",
      "Document does not have a meaningful <title> element. Page titles identify each page in browser history, bookmarks, and screen reader announcements.",
      "https://wave.webaim.org/api/references#e_title_missing", "<title>", "head > title"));
  } else {
    passCount++;
  }

  // Empty labels
  document.querySelectorAll("label").forEach((label: any) => {
    const text = getTextContent(label);
    const hasImgAlt = label.querySelector("img[alt]:not([alt=''])");
    if (text.length === 0 && !hasImgAlt) {
      violations.push(makeViolation("label-empty", "serious", "WCAG 1.3.1",
        "A <label> element exists but is empty. An empty label provides no information to screen reader users about the associated form control.",
        "https://wave.webaim.org/api/references#e_label_empty",
        elHtml(label), buildLocator(label)));
    }
  });

  // Multiple labels (same for= target)
  document.querySelectorAll("input, select, textarea").forEach((ctrl: any) => {
    const id = ctrl.getAttribute("id");
    if (!id) return;
    const count = labelForCounts[id] || 0;
    if (count > 1) {
      violations.push(makeViolation("multiple-labels", "serious", "WCAG 1.3.1",
        `Form control with id="${id}" has ${count} associated <label> elements. Multiple labels create ambiguous instructions for screen reader users.`,
        "https://wave.webaim.org/api/references#e_label_multiple",
        elHtml(ctrl), buildLocator(ctrl)));
    }
  });

  // Empty headings
  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((heading: any) => {
    const name = computeAccName(heading);
    if (!name) {
      const level = heading.tagName[1];
      violations.push(makeViolation("empty-heading", "serious", "WCAG 1.3.1",
        `Heading level ${level} (<${heading.tagName.toLowerCase()}>) is empty. Empty headings disrupt screen reader navigation by creating dead landmarks.`,
        "https://wave.webaim.org/api/references#e_heading_empty",
        elHtml(heading), buildLocator(heading)));
    }
  });

  // Empty table headers
  document.querySelectorAll("th").forEach((th: any) => {
    const name = computeAccName(th);
    const abbr = th.getAttribute("abbr");
    if (!name && !(abbr && abbr.trim())) {
      violations.push(makeViolation("th-empty", "serious", "WCAG 1.3.1",
        "Table header cell (<th>) is empty. Empty headers provide no column or row information to screen reader users.",
        "https://wave.webaim.org/api/references#e_th_empty",
        elHtml(th), buildLocator(th)));
    }
  });

  // Broken ARIA references
  document.querySelectorAll("[aria-labelledby], [aria-describedby]").forEach((el: any) => {
    for (const attr of ["aria-labelledby", "aria-describedby"]) {
      const val = el.getAttribute(attr);
      if (!val) continue;
      for (const refId of val.trim().split(/\s+/)) {
        if (refId && !allIds.has(refId)) {
          violations.push(makeViolation("aria-reference-broken", "critical", "WCAG 4.1.2",
            `${attr}="${val}" references id="${refId}" which does not exist on this page. Broken ARIA references cause screen readers to fail silently.`,
            "https://wave.webaim.org/api/references#e_aria_reference_broken",
            elHtml(el), buildLocator(el)));
          break;
        }
      }
    }
  });

  // ─── Captcha detection ───
  // reCAPTCHA/hCaptcha inject hidden response textareas at runtime via JS.
  // WAVE (which executes JS) flags them as label_missing. We detect the captcha
  // presence from its script/container markers and synthesize the violation.
  const hasRecaptcha = !!document.querySelector("script[src*='recaptcha']") ||
                       !!document.querySelector(".g-recaptcha");
  if (hasRecaptcha) {
    violations.push(makeViolation("label", "serious", "WCAG 1.3.1",
      "reCAPTCHA injects a hidden response textarea (id=\"g-recaptcha-response\") without an accessible label. Screen reader users cannot identify this control.",
      "https://wave.webaim.org/api/references#e_label_missing",
      '<textarea id="g-recaptcha-response" name="g-recaptcha-response">', '#g-recaptcha-response'));
  }
  const hasHcaptcha = !!document.querySelector("script[src*='hcaptcha']") ||
                      !!document.querySelector(".h-captcha");
  if (hasHcaptcha) {
    violations.push(makeViolation("label", "serious", "WCAG 1.3.1",
      "hCaptcha injects a hidden response textarea (id=\"h-captcha-response\") without an accessible label. Screen reader users cannot identify this control.",
      "https://wave.webaim.org/api/references#e_label_missing",
      '<textarea id="h-captcha-response" name="h-captcha-response">', '#h-captcha-response'));
  }

  // ─── Structural pass bonuses ───
  if (document.querySelector("main, [role='main']")) passCount++;
  if (document.querySelector("nav, [role='navigation']")) passCount++;
  if (document.querySelector("header")) passCount++;
  if (document.querySelector("footer")) passCount++;
  if (document.querySelector("a[href^='#main'], a[href^='#content'], a[href^='#skip']")) passCount++;
  if (document.querySelector("meta[charset]")) passCount++;
  if (document.querySelector("ul, ol")) passCount++;
  if (document.querySelector("fieldset legend")) passCount++;

  return { violations, passCount };
}

// ─── Scoring ───

export function calculatePageScore(violations: Violation[], passCount: number): number {
  const w: Record<string, number> = { critical: 12, serious: 6, moderate: 2, minor: 1 };
  const deduction = violations.reduce((s, v) => s + (w[v.impact] || 1), 0);
  return Math.max(0, Math.min(100, Math.round(100 - deduction + Math.min(passCount * 0.5, 10))));
}

export function calculateOverallScore(violations: { impact: string }[], totalPages: number): number {
  if (totalPages === 0) return 0;
  const w: Record<string, number> = { critical: 15, serious: 8, moderate: 3, minor: 1 };
  return Math.max(0, Math.round(100 - violations.reduce((s, v) => s + (w[v.impact] || 1), 0)));
}
