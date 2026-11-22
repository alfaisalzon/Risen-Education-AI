
const PECTAA_BOOKS_URL =
  "https://pectaa.edu.pk/books-and-publications/";

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
        const response = await fetch(PECTAA_BOOKS_URL, {
          headers: {
            "Accept": "text/html"
          }
        });

        if (!response.ok) {
          return respond({
            success: false,
            error: "Official book catalog could not be loaded.",
            officialSource: PECTAA_BOOKS_URL
          }, 502);
        }

        const html = await response.text();

        const books = [];
        const anchorRegex =
          /<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

        let match;

        while ((match = anchorRegex.exec(html)) !== null) {
          const href = match[2]
            .replace(/&amp;/g, "&");

          const title = match[3]
            .replace(/<[^>]*>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&#8217;/g, "'")
            .replace(/&#038;/g, "&")
            .replace(/\s+/g, " ")
            .trim();

          if (!title || !href) continue;

          let link;
          try {
            link = new URL(href, PECTAA_BOOKS_URL);
          } catch {
            continue;
          }

          const allowed =
            link.hostname === "drive.google.com" ||
            link.hostname === "pctb.punjab.gov.pk" ||
            link.hostname === "pectaa.edu.pk";

          if (!allowed) continue;

          if (
            /home|about|contact|privacy|login|subscribe/i.test(title)
          ) continue;

          books.push({
            title,
            url: link.href,
            source: "PECTAA"
          });
        }

        const uniqueBooks = [
          ...new Map(
            books.map(book => [book.url, book])
          ).values()
        ];

        return respond({
          success: true,
          source: PECTAA_BOOKS_URL,
          total: uniqueBooks.length,
          message:
            "Official catalog links retrieved. Verify class, medium and edition before use.",
          books: uniqueBooks
        });

      } catch (error) {
        return respond({
          success: false,
          error: "Book catalog request failed.",
          detail: error.message,
          officialSource: PECTAA_BOOKS_URL
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

        if (!subject || !chapter || !sourceText) {
          return respond({
            success: false,
            error:
              "Subject, chapter and sourceText are required."
          }, 400);
        }

        const prompt = `
You are an educational assistant for The Risen High School.

Use ONLY the supplied textbook content.
Do not invent textbook facts.
If information is missing, clearly say so.
Use age-appropriate educational explanations.

Subject: ${subject}
Chapter: ${chapter}
Task: ${task || "Create notes and questions"}

Textbook content:
${String(sourceText).slice(0, 12000)}
`;

        const result = await env.AI.run(
          "@cf/meta/llama-3.1-8b-instruct",
          {
            prompt,
            max_tokens: 1800
          }
        );

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
