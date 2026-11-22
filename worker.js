
const PECTAA_BOOKS_URL =
  "https://pectaa.edu.pk/curriculum-compliance/";

const PECTAA_FALLBACK_URL =
  "https://pectaa.edu.pk/books-and-publications/";

const MODEL = "@cf/meta/llama-3.1-8b-instruct";

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    const respond = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...cors,
          "Content-Type": "application/json; charset=utf-8"
        }
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const url = new URL(request.url);

    // HEALTH CHECK
    if (
      url.pathname === "/" ||
      url.pathname === "/api/health"
    ) {
      return respond({
        success: true,
        message: "Risen Education AI Worker is running."
      });
    }

    // OFFICIAL BOOK CATALOG
    if (
      url.pathname === "/api/books" &&
      request.method === "GET"
    ) {
      try {
        let response = await fetch(PECTAA_BOOKS_URL, {
          headers: {
            "Accept": "text/html",
            "User-Agent": "Risen-Education-AI/1.0"
          }
        });

        let source = PECTAA_BOOKS_URL;

        if (!response.ok) {
          response = await fetch(PECTAA_FALLBACK_URL, {
            headers: {
              "Accept": "text/html"
            }
          });

          source = PECTAA_FALLBACK_URL;
        }

        if (!response.ok) {
          return respond({
            success: false,
            error: "PECTAA catalog could not be loaded.",
            status: response.status
          }, 502);
        }

        const html = await response.text();

        const decodeHTML = (value) =>
          value
            .replace(/&amp;/g, "&")
            .replace(/&nbsp;/g, " ")
            .replace(/&#8217;|&rsquo;/g, "'")
            .replace(/&#8216;|&lsquo;/g, "'")
            .replace(/&#038;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");

        const cleanText = (value) =>
          decodeHTML(value.replace(/<[^>]*>/g, " "))
            .replace(/\s+/g, " ")
            .trim();

        function identifyGrade(title) {
          const t = title.toLowerCase();

          if (
            /class[\s-]*ix[\s-]*x|grade[\s-]*9[\s-]*10|9[\s-]*[-–][\s-]*10/.test(t)
          ) return "9-10";

          if (
            /class[\s-]*xi[\s-]*xii|grade[\s-]*11[\s-]*12|11[\s-]*[-–][\s-]*12/.test(t)
          ) return "11-12";

          if (
            /\b(grade[\s-]*9|class[\s-]*ix)\b|\b9\b/.test(t)
          ) return "9";

          if (
            /\b(grade[\s-]*10|class[\s-]*x)\b|\b10\b/.test(t)
          ) return "10";

          if (
            /\b(grade[\s-]*11|class[\s-]*xi)\b|\b11\b/.test(t)
          ) return "11";

          if (
            /\b(grade[\s-]*12|class[\s-]*xii)\b|\b12\b/.test(t)
          ) return "12";

          return "unverified";
        }

        function identifyMedium(title) {
          const t = title.toLowerCase();

          if (
            /\b(um|urdu medium)\b/.test(t)
          ) return "UM";

          if (
            /\b(em|english medium)\b/.test(t)
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

          if (/pairing scheme|pairing schemes/.test(t)) {
            return "pairing-scheme";
          }

          if (/smart syllabus|deleted topics|alp/.test(t)) {
            return "syllabus";
          }

          if (/model paper|model papers/.test(t)) {
            return "model-paper";
          }

          if (/practical video|practical notebook/.test(t)) {
            return "practical";
          }

          return "textbook";
        }

        function identifyCategory(title) {
          const t = title.toLowerCase();

          if (
            /tarjuma|islamiat|islamiyat|islamic studies|masihi taleem/.test(t)
          ) return "compulsory";

          if (
            /urdu|english|pakistan studies|mutalia pakistan/.test(t)
          ) return "compulsory";

          if (
            /biology|physics|chemistry|computer|mathematics|math/.test(t)
          ) return "group-subject";

          if (
            /economics|statistics|civics|psychology|education|punjabi|farsi/.test(t)
          ) return "elective";

          return "unverified";
        }

        const anchorRegex =
          /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

        const books = [];
        let match;

        while ((match = anchorRegex.exec(html)) !== null) {
          const href = decodeHTML(match[2]).trim();
          const title = cleanText(match[3]);

          if (!href || !title) continue;

          let link;

          try {
            link = new URL(href, source);
          } catch {
            continue;
          }

          const host = link.hostname.toLowerCase();

          const allowed =
            host === "drive.google.com" ||
            host === "pctb.punjab.gov.pk" ||
            host === "pectaa.edu.pk";

          if (!allowed) continue;

          const isFile =
            host === "drive.google.com" &&
            /\/file\/d\//.test(link.pathname);

          const isPDF =
            /\.pdf($|\?)/i.test(link.pathname + link.search);

          if (!isFile && !isPDF) continue;

          if (
            /download|read more|click here|view|home|contact/i.test(title)
          ) continue;

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

        let filtered = unique;

        if (gradeFilter) {
          filtered = filtered.filter(book =>
            book.grade === gradeFilter ||
            book.grade === `${gradeFilter}-${Number(gradeFilter) + 1}`
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

        return respond({
          success: true,
          source,
          total: unique.length,
          filteredTotal: filtered.length,
          unverified: unique.filter(book =>
            book.grade === "unverified" ||
            book.medium === "unverified"
          ).length,
          message:
            "Official links retrieved. Unverified class, medium and edition details require confirmation.",
          filters: {
            grade: gradeFilter || "all",
            medium: mediumFilter || "all",
            type: typeFilter || "all"
          },
          books: filtered
        });

      } catch (error) {
        return respond({
          success: false,
          error: "Book catalog request failed.",
          detail: error.message
        }, 500);
      }
    }

    // AI MATERIAL GENERATION
    if (
      url.pathname === "/api/generate-material" &&
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
          result: result.response || result
        });

      } catch (error) {
        return respond({
          success: false,
          error: "Material generation failed.",
          detail: error.message
        }, 500);
      }
    }

    return respond({
      success: false,
      error: "API route not found."
    }, 404);
  }
};
