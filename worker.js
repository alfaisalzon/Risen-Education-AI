
const PECTAA_BOOKS_URL =
  "https://pectaa.edu.pk/curriculum-compliance/";

const PECTAA_FALLBACK_URL =
  "https://pectaa.edu.pk/books-and-publications/";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";
const WORKER_VERSION = "RISEN-BOOKS-V3-2026-11-22";

const MAX_PDF_SIZE = 30 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    const respond = (data, status = 200) =>
      new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
          ...cors,
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // VERSION / HEALTH CHECK
    if (path === "/" || path === "/api/health") {
      return respond({
        success: true,
        worker: "Risen Education AI",
        version: WORKER_VERSION,
        message: "Worker is running."
      });
    }

    // PDF PROXY
    // Only approved education websites and Google Drive are allowed.
    if (path === "/api/pdf" && request.method === "GET") {
      try {
        const suppliedUrl = url.searchParams.get("url");

        if (!suppliedUrl) {
          return respond({
            success: false,
            error: "PDF URL is required."
          }, 400);
        }

        let pdfUrl;

        try {
          pdfUrl = new URL(suppliedUrl);
        } catch {
          return respond({
            success: false,
            error: "Invalid PDF URL."
          }, 400);
        }

        const inputHosts = [
          "pectaa.edu.pk",
          "www.pectaa.edu.pk",
          "pctb.punjab.gov.pk",
          "drive.google.com",
          "drive.usercontent.google.com"
        ];

        function isAllowedInputHost(host) {
          return inputHosts.includes(host.toLowerCase());
        }

        if (
          pdfUrl.protocol !== "https:" ||
          !isAllowedInputHost(pdfUrl.hostname)
        ) {
          return respond({
            success: false,
            error: "This PDF website is not allowed."
          }, 403);
        }

        // Convert common Google Drive sharing links to download links.
        if (pdfUrl.hostname === "drive.google.com") {
          let fileId = "";

          const pathMatch = pdfUrl.pathname.match(
            /\/file\/d\/([a-zA-Z0-9_-]+)/
          );

          if (pathMatch) {
            fileId = pathMatch[1];
          } else {
            fileId = pdfUrl.searchParams.get("id") || "";
          }

          if (fileId) {
            pdfUrl = new URL("https://drive.google.com/uc");
            pdfUrl.searchParams.set("export", "download");
            pdfUrl.searchParams.set("id", fileId);
          }
        }

        // Validate every redirect to prevent this route becoming an open proxy.
        function isAllowedRedirectHost(host) {
          const allowed = [
            "pectaa.edu.pk",
            "www.pectaa.edu.pk",
            "pctb.punjab.gov.pk",
            "drive.google.com",
            "drive.usercontent.google.com",
            "docs.googleusercontent.com"
          ];

          return (
            allowed.includes(host.toLowerCase()) ||
            host.toLowerCase().endsWith(".googleusercontent.com")
          );
        }

        let currentUrl = pdfUrl;
        let pdfResponse = null;

        for (let i = 0; i < 6; i++) {
          if (
            currentUrl.protocol !== "https:" ||
            !isAllowedRedirectHost(currentUrl.hostname)
          ) {
            return respond({
              success: false,
              error: "PDF redirect destination is not allowed."
            }, 403);
          }

          const result = await fetch(currentUrl.toString(), {
            method: "GET",
            redirect: "manual",
            headers: {
              "Accept": "application/pdf,application/octet-stream,*/*",
              "User-Agent": "Mozilla/5.0 RisenEducationAI"
            }
          });

          if (
            result.status >= 300 &&
            result.status < 400
          ) {
            const location = result.headers.get("Location");

            if (!location) {
              return respond({
                success: false,
                error: "PDF redirect did not provide a destination."
              }, 502);
            }

            currentUrl = new URL(location, currentUrl);
            continue;
          }

          pdfResponse = result;
          break;
        }

        if (!pdfResponse) {
          return respond({
            success: false,
            error: "Too many PDF redirects."
          }, 502);
        }

        if (!pdfResponse.ok) {
          return respond({
            success: false,
            error: "PDF could not be downloaded.",
            httpStatus: pdfResponse.status
          }, 502);
        }

        const contentType = (
          pdfResponse.headers.get("Content-Type") || ""
        ).toLowerCase();

        const contentLength = Number(
          pdfResponse.headers.get("Content-Length") || 0
        );

        if (contentLength > MAX_PDF_SIZE) {
          return respond({
            success: false,
            error: "PDF is too large. Maximum allowed size is 30 MB."
          }, 413);
        }

        // Read the response with a strict size limit.
        if (!pdfResponse.body) {
          return respond({
            success: false,
            error: "The PDF file is empty."
          }, 502);
        }

        const reader = pdfResponse.body.getReader();
        const chunks = [];
        let totalBytes = 0;

        while (true) {
          const part = await reader.read();

          if (part.done) break;

          totalBytes += part.value.byteLength;

          if (totalBytes > MAX_PDF_SIZE) {
            await reader.cancel();

            return respond({
              success: false,
              error: "PDF is too large. Maximum allowed size is 30 MB."
            }, 413);
          }

          chunks.push(part.value);
        }

        const fileBytes = new Uint8Array(totalBytes);
        let offset = 0;

        for (const chunk of chunks) {
          fileBytes.set(chunk, offset);
          offset += chunk.byteLength;
        }

        // Confirm that the downloaded file is really a PDF.
        const signature = new TextDecoder().decode(
          fileBytes.slice(0, 5)
        );

        if (
          signature !== "%PDF-" ||
          contentType.includes("text/html")
        ) {
          return respond({
            success: false,
            error:
              "The link did not return a direct PDF file. Google Drive confirmation pages or protected files may not work."
          }, 422);
        }

        return new Response(fileBytes, {
          status: 200,
          headers: {
            ...cors,
            "Content-Type": "application/pdf",
            "Content-Length": String(totalBytes),
            "Content-Disposition": "inline; filename=\"risen-book.pdf\"",
            "Cache-Control": "public, max-age=3600",
            "X-Content-Type-Options": "nosniff"
          }
        });

      } catch (error) {
        return respond({
          success: false,
          error: "PDF request failed.",
          detail: String(error.message || error)
        }, 500);
      }
    }

    // OFFICIAL BOOK CATALOG
    if (path === "/api/books" && request.method === "GET") {
      try {
        let response = await fetch(PECTAA_BOOKS_URL, {
          headers: {
            "Accept": "text/html",
            "User-Agent": "Mozilla/5.0 RisenEducationAI"
          }
        });

        let source = PECTAA_BOOKS_URL;

        if (!response.ok) {
          response = await fetch(PECTAA_FALLBACK_URL, {
            headers: {
              "Accept": "text/html",
              "User-Agent": "Mozilla/5.0 RisenEducationAI"
            }
          });

          source = PECTAA_FALLBACK_URL;
        }

        if (!response.ok) {
          return respond({
            success: false,
            version: WORKER_VERSION,
            error: "PECTAA catalog could not be loaded.",
            httpStatus: response.status
          }, 502);
        }

        const html = await response.text();

        function decodeHTML(value) {
          return value
            .replace(/&amp;/gi, "&")
            .replace(/&nbsp;/gi, " ")
            .replace(/&#8217;|&rsquo;/gi, "'")
            .replace(/&#8216;|&lsquo;/gi, "'")
            .replace(/&#038;/gi, "&")
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/&lt;/gi, "<")
            .replace(/&gt;/gi, ">")
            .replace(/&#(\d+);/g, (_, n) =>
              String.fromCharCode(Number(n))
            );
        }

        function cleanText(value) {
          return decodeHTML(
            value
              .replace(/<script[\s\S]*?<\/script>/gi, " ")
              .replace(/<style[\s\S]*?<\/style>/gi, " ")
              .replace(/<[^>]*>/g, " ")
          )
            .replace(/\s+/g, " ")
            .trim();
        }

        function identifyGrade(title) {
          const t = title.toLowerCase();

          if (
            /class\s*(ix|9)\s*[-–]\s*(x|10)/i.test(t) ||
            /grade\s*9\s*[-–]\s*10/i.test(t) ||
            /\b9\s*[-–]\s*10\b/.test(t)
          ) return "9-10";

          if (
            /class\s*(xi|11)\s*[-–]\s*(xii|12)/i.test(t) ||
            /grade\s*11\s*[-–]\s*12/i.test(t) ||
            /\b11\s*[-–]\s*12\b/.test(t)
          ) return "11-12";

          if (
            /\bclass\s*ix\b/.test(t) ||
            /\bgrade\s*9\b/.test(t) ||
            /\bclass\s*9\b/.test(t) ||
            /\b9th\b/.test(t) ||
            /\b(?:physics|chemistry|biology|computer|math|mathematics|urdu|english)\s*9\b/.test(t)
          ) return "9";

          if (
            /\bclass\s*x\b/.test(t) ||
            /\bgrade\s*10\b/.test(t) ||
            /\bclass\s*10\b/.test(t) ||
            /\b10th\b/.test(t) ||
            /\b(?:physics|chemistry|biology|computer|math|mathematics|urdu|english)\s*10\b/.test(t)
          ) return "10";

          if (
            /\bclass\s*xi\b/.test(t) ||
            /\bgrade\s*11\b/.test(t) ||
            /\bclass\s*11\b/.test(t) ||
            /\b11th\b/.test(t) ||
            /\b(?:physics|chemistry|biology|computer|math|mathematics|urdu|english)\s*11\b/.test(t)
          ) return "11";

          if (
            /\bclass\s*xii\b/.test(t) ||
            /\bgrade\s*12\b/.test(t) ||
            /\bclass\s*12\b/.test(t) ||
            /\b12th\b/.test(t) ||
            /\b(?:physics|chemistry|biology|computer|math|mathematics|urdu|english)\s*12\b/.test(t)
          ) return "12";

          return "unverified";
        }

        function identifyMedium(title) {
          const t = title.toLowerCase();

          if (
            /\b(um|urdu medium)\b/.test(t) ||
            /اردو میڈیم/.test(t)
          ) return "UM";

          if (
            /\b(em|english medium)\b/.test(t) ||
            /english medium/.test(t)
          ) return "EM";

          return "unverified";
        }

        function identifyEdition(title) {
          const match = title.match(
            /20\d{2}\s*[-–/]\s*\d{2,4}|20\d{2}/
          );

          return match ? match[0] : "unverified";
        }

        function identifyType(title) {
          const t = title.toLowerCase();

          if (/pairing scheme|pairing schemes/.test(t))
            return "pairing-scheme";

          if (/smart syllabus|deleted topics|alp|accelerated learning/.test(t))
            return "syllabus";

          if (/model paper|model papers/.test(t))
            return "model-paper";

          if (/practical video|practical notebook|pnb/.test(t))
            return "practical";

          if (/curriculum|scheme of studies/.test(t))
            return "curriculum";

          return "textbook";
        }

        function identifyCategory(title) {
          const t = title.toLowerCase();

          if (
            /tarjuma|islamiat|islamiyat|islamic studies|masihi taleem|christianity|akhlaqiat/.test(t)
          ) return "compulsory";

          if (
            /\burdu\b|english|pakistan studies|mutalia pakistan/.test(t)
          ) return "compulsory";

          if (
            /biology|physics|chemistry|computer|mathematics|math|science|entrepreneurship/.test(t)
          ) return "group-subject";

          if (
            /economics|statistics|civics|psychology|education|punjabi|farsi|geography|history|home economics|agriculture/.test(t)
          ) return "elective";

          return "unverified";
        }

        function isNavigationTitle(title) {
          const t = title.toLowerCase();

          return (
            !title ||
            title.length < 2 ||
            /^(home|overview|about us|vision|mission|contact|contact us|board of governors|downloads|download|read more|click here|view|login|search|menu|news|events|gallery|career|careers|tender|tenders|notification|notifications|advertisement|advertisements)$/i.test(t) ||
            /read more|click here|view details|learn more|visit website/i.test(t)
          );
        }

        const anchorRegex =
          /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

        const books = [];
        let match;
        let anchorsScanned = 0;
        let allowedLinks = 0;
        let rejectedNavigation = 0;

        while ((match = anchorRegex.exec(html)) !== null) {
          anchorsScanned++;

          const href = decodeHTML(match[2]).trim();
          const title = cleanText(match[3]);

          if (!href || !title) continue;

          if (isNavigationTitle(title)) {
            rejectedNavigation++;
            continue;
          }

          let link;

          try {
            link = new URL(href, source);
          } catch {
            continue;
          }

          const host = link.hostname.toLowerCase();

          const allowedHost =
            host === "drive.google.com" ||
            host.endsWith(".google.com") ||
            host === "pctb.punjab.gov.pk" ||
            host.endsWith(".pctb.punjab.gov.pk") ||
            host === "pectaa.edu.pk" ||
            host.endsWith(".pectaa.edu.pk");

          if (!allowedHost) continue;

          const isDriveLink =
            host.includes("google.com") &&
            (
              /\/file\/d\//.test(link.pathname) ||
              /\/open/.test(link.pathname) ||
              link.searchParams.has("id")
            );

          const isPDF =
            /\.pdf($|\?)/i.test(link.pathname + link.search);

          if (!isDriveLink && !isPDF) continue;

          allowedLinks++;

          const type = identifyType(title);

          books.push({
            title,
            url: link.href,
            source: "PECTAA",
            grade: identifyGrade(title),
            medium: identifyMedium(title),
            edition: identifyEdition(title),
            category: identifyCategory(title),
            type
          });
        }

        const unique = [
          ...new Map(
            books.map(book => [book.url, book])
          ).values()
        ];

        const gradeFilter = url.searchParams.get("grade");
        const mediumFilter = url.searchParams.get("medium");
        const typeFilter = url.searchParams.get("type");
        const categoryFilter = url.searchParams.get("category");

        let filtered = unique;

        if (gradeFilter) {
          filtered = filtered.filter(book =>
            book.grade === gradeFilter
          );
        }

        if (mediumFilter) {
          filtered = filtered.filter(book =>
            book.medium === mediumFilter.toUpperCase()
          );
        }

        if (typeFilter) {
          filtered = filtered.filter(book =>
            book.type === typeFilter
          );
        }

        if (categoryFilter) {
          filtered = filtered.filter(book =>
            book.category === categoryFilter
          );
        }

        return respond({
          success: true,
          version: WORKER_VERSION,
          source,
          total: unique.length,
          filteredTotal: filtered.length,
          unverified: unique.filter(book =>
            book.grade === "unverified" ||
            book.medium === "unverified" ||
            book.category === "unverified"
          ).length,

          diagnostics: {
            anchorsScanned,
            allowedLinks,
            rejectedNavigation,
            uniqueBooks: unique.length
          },

          message:
            "Official links collected. Class, medium and edition should be verified against the official book.",

          filters: {
            grade: gradeFilter || "all",
            medium: mediumFilter || "all",
            type: typeFilter || "all",
            category: categoryFilter || "all"
          },

          books: filtered
        });

      } catch (error) {
        return respond({
          success: false,
          version: WORKER_VERSION,
          error: "Book catalog request failed.",
          detail: String(error.message || error)
        }, 500);
      }
    }

    // AI MATERIAL GENERATION
    if (
      path === "/api/generate-material" &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();

        const {
          subject,
          chapter,
          sourceText,
          task
        } = body;

        if (
          !subject ||
          !chapter ||
          !sourceText ||
          typeof sourceText !== "string"
        ) {
          return respond({
            success: false,
            version: WORKER_VERSION,
            error: "Subject, chapter and sourceText are required."
          }, 400);
        }

        const prompt = `
You are an educational assistant for The Risen High School.

Use ONLY the supplied textbook content.
Do not invent textbook facts.
If information is missing, clearly say so.
Use clear Urdu when requested.
Use age-appropriate educational explanations.

Subject: ${subject}
Chapter: ${chapter}
Task: ${task || "Create notes and questions"}

Textbook content:
${sourceText.slice(0, 12000)}
`;

        const result = await env.AI.run(MODEL, {
          prompt,
          max_tokens: 1800
        });

        return respond({
          success: true,
          version: WORKER_VERSION,
          result: result.response || result
        });

      } catch (error) {
        return respond({
          success: false,
          version: WORKER_VERSION,
          error: "Material generation failed.",
          detail: String(error.message || error)
        }, 500);
      }
    }

    return respond({
      success: false,
      version: WORKER_VERSION,
      error: "API route not found.",
      path
    }, 404);
  }
};
