import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";

import {
  useCreateSubject,
  getListSubjectsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/lib/i18n";

const formSchema = z.object({
  title: z.string().trim().min(1).max(100),
});

export function CreateSubjectForm() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useLanguage();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: {
      title: "",
    },
  });

  const createSubject = useCreateSubject();

  function onSubmit(values: z.infer<typeof formSchema>) {
    createSubject.mutate(
      { data: values },
      {
        onSuccess: (newSubject) => {
          queryClient.invalidateQueries({
            queryKey: getListSubjectsQueryKey(),
          });
          toast({
            title: t("subjectCreated"),
            description: t("readyCollect"),
          });
          form.reset();
          setLocation(`/subjects/${newSubject.id}`);
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("createFailed"),
          });
        },
      },
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex items-center gap-2"
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="flex-1 space-y-0">
              <FormControl>
                <Input
                  placeholder={t("newSubject")}
                  aria-label={t("newSubject")}
                  className="bg-transparent border-t-0 border-x-0 border-b-2 border-primary/20 rounded-none focus-visible:ring-0 focus-visible:border-primary px-1 font-serif text-lg placeholder:font-sans placeholder:text-base placeholder:text-muted-foreground"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          size="icon"
          variant="outline"
          className="rounded-full shrink-0 border-primary/20 text-primary hover:bg-primary/5 hover:border-primary/50"
          disabled={createSubject.isPending || !form.formState.isValid}
        >
          <Plus className="h-4 w-4" />
          <span className="sr-only">{t("createSubject")}</span>
        </Button>
      </form>
    </Form>
  );
}
