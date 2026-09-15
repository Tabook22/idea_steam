import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListIdeaChatMessagesQueryKey,
  useClearIdeaChat,
  useListIdeaChatMessages,
  useSendIdeaChatMessage,
} from "@workspace/api-client-react";
import { Bot, Loader2, MessageCircle, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

export function IdeaChatDialog({ ideaId }: { ideaId: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { isArabic, t } = useLanguage();
  const { toast } = useToast();
  const { data: messages = [], isLoading } = useListIdeaChatMessages(ideaId, {
    query: {
      queryKey: getListIdeaChatMessagesQueryKey(ideaId),
      enabled: isOpen,
    },
  });
  const sendMessage = useSendIdeaChatMessage();
  const clearChat = useClearIdeaChat();

  useEffect(() => {
    if (isOpen) {
      window.setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }, [isOpen, messages.length, sendMessage.isPending]);

  const handleSend = () => {
    const content = message.trim();
    if (!content || sendMessage.isPending) return;

    setMessage("");
    sendMessage.mutate(
      { ideaId, data: { content } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getListIdeaChatMessagesQueryKey(ideaId),
          });
        },
        onError: () => {
          setMessage(content);
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("ideaChatFailed"),
          });
        },
      },
    );
  };

  const handleClear = () => {
    clearChat.mutate(
      { ideaId },
      {
        onSuccess: () => {
          queryClient.setQueryData(getListIdeaChatMessagesQueryKey(ideaId), []);
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("clearChatFailed"),
          });
        },
      },
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 px-2.5 text-primary hover:bg-primary/10 hover:text-primary"
        >
          <MessageCircle className="h-4 w-4" />
          <span className="hidden sm:inline">{t("chatWithIdea")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[85dvh] w-[96vw] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:h-[80dvh]">
        <DialogHeader className="border-b px-4 py-4 pe-14 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle>{t("chatWithIdea")}</DialogTitle>
              <DialogDescription className="mt-1">
                {t("ideaChatDescription")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 bg-muted/20">
          <div className="space-y-4 p-4 sm:p-6">
            {isLoading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex min-h-52 max-w-md flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-serif text-lg font-semibold">{t("startIdeaChat")}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t("ideaChatEmpty")}
                </p>
              </div>
            ) : (
              messages.map((chatMessage) => (
                <div
                  key={chatMessage.id}
                  className={`flex ${chatMessage.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      chatMessage.role === "user"
                        ? "rounded-ee-sm bg-primary text-primary-foreground"
                        : "rounded-es-sm border bg-card text-foreground shadow-sm"
                    }`}
                  >
                    {chatMessage.content}
                  </div>
                </div>
              ))
            )}
            {sendMessage.isPending && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-es-sm border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {t("ideaChatThinking")}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </ScrollArea>

        <div className="border-t bg-background p-3 sm:p-4">
          <div className="flex items-end gap-2">
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t("ideaChatPlaceholder")}
              className="max-h-36 min-h-11 resize-none"
              dir={isArabic ? "rtl" : "ltr"}
              disabled={sendMessage.isPending}
            />
            <Button
              type="button"
              size="icon"
              className="h-11 w-11 shrink-0"
              onClick={handleSend}
              disabled={!message.trim() || sendMessage.isPending}
              aria-label={t("sendMessage")}
            >
              {sendMessage.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className={`h-4 w-4 ${isArabic ? "rotate-180" : ""}`} />
              )}
            </Button>
          </div>
          <DialogFooter className="mt-2 flex-row items-center justify-between sm:justify-between">
            <p className="text-[11px] text-muted-foreground">{t("ideaChatHint")}</p>
            {messages.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-destructive"
                onClick={handleClear}
                disabled={clearChat.isPending || sendMessage.isPending}
              >
                <Trash2 className="me-1.5 h-3.5 w-3.5" />
                {clearChat.isPending ? t("clearingChat") : t("clearChat")}
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}