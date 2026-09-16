declare module "html-to-docx" {
  interface DocumentOptions {
    title?: string;
    creator?: string;
    description?: string;
    orientation?: "portrait" | "landscape";
  }

  export default function htmlToDocx(
    htmlString: string,
    headerHtmlString?: string | null,
    documentOptions?: DocumentOptions,
    footerHtmlString?: string | null,
  ): Promise<Buffer>;
}