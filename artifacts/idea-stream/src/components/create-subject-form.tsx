import { useRef, useState, type FormEvent } from "react";
import { Loader2, Plus } from "lucide-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateSubject,
  getListSubjectsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";

export function CreateSubjectForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t, isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [titleInvalid, setTitleInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const createSubject = useCreateSubject();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    // Read the submitted field too, so autofill does not depend on a form
    // library's asynchronous validity state before Save can be used.
    const name = String(
      new FormData(event.currentTarget).get("title") ?? "",
    ).trim();
    if (!name || name.length > 100) {
      setTitleInvalid(true);
      setError(
        !name
          ? copy("Enter a name for your notebook.", "أدخل اسمًا لدفترك.")
          : copy(
              "Use 100 characters or fewer for the notebook name.",
              "استخدم 100 حرف أو أقل لاسم الدفتر.",
            ),
      );
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setTitleInvalid(false);
    submitting.current = true;
    try {
      const newSubject = await createSubject.mutateAsync({
        data: { title: name },
      });
      void queryClient.invalidateQueries({
        queryKey: getListSubjectsQueryKey(),
      });
      toast({ title: t("subjectCreated"), description: t("readyCollect") });
      setLocation(`/subjects/${newSubject.id}`);
    } catch {
      setError(
        copy(
          "Couldn't save your notebook. Your title is still here. Check your connection and try again.",
          "تعذّر حفظ الدفتر. ما زال الاسم محفوظًا هنا. تحقق من اتصالك وحاول مجددًا.",
        ),
      );
    } finally {
      submitting.current = false;
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4"
      aria-busy={createSubject.isPending}
    >
      <div className="space-y-2">
        <label htmlFor="new-notebook-title" className="text-sm font-medium">
          {copy("Notebook name", "اسم الدفتر")}
        </label>
        <Input
          ref={inputRef}
          id="new-notebook-title"
          name="title"
          placeholder={t("newSubject")}
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
            setTitleInvalid(false);
          }}
          disabled={createSubject.isPending}
          aria-invalid={titleInvalid}
          aria-describedby={
            error
              ? "notebook-title-help notebook-create-error"
              : "notebook-title-help"
          }
          autoComplete="off"
          className="h-12"
        />
        <p id="notebook-title-help" className="text-xs text-muted-foreground">
          {copy(
            "A short name, up to 100 characters.",
            "اسم قصير لا يزيد عن 100 حرف.",
          )}
          <span className="ms-2" dir="ltr">
            {title.trim().length}/100
          </span>
        </p>
      </div>
      {error && (
        <p
          id="notebook-create-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full gap-2"
        disabled={createSubject.isPending}
      >
        {createSubject.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
        {createSubject.isPending
          ? copy("Creating notebook…", "جارٍ إنشاء الدفتر…")
          : copy("Create notebook", "إنشاء دفتر")}
      </Button>
    </form>
  );
}
