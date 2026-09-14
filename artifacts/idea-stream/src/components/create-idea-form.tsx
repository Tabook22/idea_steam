import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Mic, Square, Send, PenTool, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import {
  IdeaInputSource,
  useCreateIdea,
  getGetSubjectQueryKey,
  getListIdeasQueryKey,
} from "@workspace/api-client-react";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  content: z.string().min(1, "Fragment content is required"),
});

interface CreateIdeaFormProps {
  subjectId: number;
}

export function CreateIdeaForm({ subjectId }: CreateIdeaFormProps) {
  const [activeTab, setActiveTab] = useState<"text" | "voice">("text");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const { 
    isRecording, 
    isSupported, 
    transcript, 
    startRecording, 
    stopRecording, 
    resetTranscript 
  } = useAudioRecorder();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      content: "",
    },
  });

  const createIdea = useCreateIdea();

  // Sync transcript to form when recording stops and transcript exists
  useEffect(() => {
    if (!isRecording && transcript && activeTab === "voice") {
      form.setValue("content", transcript);
    }
  }, [isRecording, transcript, activeTab, form]);

  const onSubmit = (values: z.infer<typeof formSchema>) => {
    const source = activeTab === "voice" && transcript 
      ? IdeaInputSource.voice 
      : IdeaInputSource.text;

    createIdea.mutate(
      { 
        subjectId, 
        data: { 
          content: values.content,
          source 
        } 
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListIdeasQueryKey(subjectId) });
          queryClient.invalidateQueries({ queryKey: getGetSubjectQueryKey(subjectId) });
          toast({
            title: "Fragment added",
          });
          form.reset();
          resetTranscript();
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Error",
            description: "Failed to save fragment.",
          });
        }
      }
    );
  };

  const handleStopRecording = () => {
    stopRecording();
  };

  return (
    <Card className="border-border shadow-sm bg-card/50 overflow-hidden">
      <div className="flex border-b border-border/50">
        <button
          className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            activeTab === "text" 
              ? "bg-card text-foreground border-b-2 border-primary" 
              : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
          }`}
          onClick={() => setActiveTab("text")}
          type="button"
        >
          <PenTool className="h-4 w-4" /> Type
        </button>
        <button
          className={`flex-1 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
            activeTab === "voice" 
              ? "bg-card text-foreground border-b-2 border-primary" 
              : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
          }`}
          onClick={() => setActiveTab("voice")}
          type="button"
        >
          <Mic className="h-4 w-4" /> Voice
        </button>
      </div>

      <CardContent className="p-4 sm:p-6 bg-card">
        {activeTab === "voice" && !isSupported ? (
          <div className="py-8 text-center bg-destructive/5 rounded-lg border border-destructive/20 text-destructive flex flex-col items-center">
            <AlertCircle className="h-8 w-8 mb-3 opacity-80" />
            <p className="font-medium">Voice capture not supported</p>
            <p className="text-sm opacity-80 mt-1 max-w-sm">
              Your browser doesn't support the required audio recording APIs. Please use the text tab or try a different browser like Chrome.
            </p>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              
              {activeTab === "voice" && (
                <div className="flex flex-col items-center justify-center py-6 px-4 bg-muted/20 rounded-lg border border-border/50 mb-4">
                  {isRecording ? (
                    <div className="text-center">
                      <div className="relative mb-6">
                        <div className="absolute inset-0 bg-destructive/20 rounded-full animate-ping"></div>
                        <Button 
                          type="button" 
                          variant="destructive" 
                          size="icon"
                          className="h-16 w-16 rounded-full relative z-10 shadow-lg"
                          onClick={handleStopRecording}
                        >
                          <Square className="h-6 w-6 fill-current" />
                        </Button>
                      </div>
                      <p className="text-sm font-medium text-destructive animate-pulse">Recording...</p>
                      <p className="text-xs text-muted-foreground mt-2 max-w-xs h-10 overflow-hidden">
                        {transcript || "Listening..."}
                      </p>
                    </div>
                  ) : (
                    <div className="text-center">
                      <Button 
                        type="button" 
                        variant="outline" 
                        className="h-16 w-16 rounded-full mb-4 border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-all shadow-sm group"
                        onClick={startRecording}
                      >
                        <Mic className="h-7 w-7 group-hover:scale-110 transition-transform" />
                      </Button>
                      <p className="text-sm font-medium">Tap to speak</p>
                      {transcript && (
                        <p className="text-xs text-muted-foreground mt-2">
                          Review and edit your transcript below before saving.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea 
                        placeholder={activeTab === "text" ? "Jot down a quick thought, link, or fragment..." : "Your transcript will appear here. Feel free to edit before saving."}
                        className="min-h-[120px] resize-y bg-transparent border-input focus-visible:ring-primary/20 text-base" 
                        {...field} 
                        disabled={isRecording}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="flex justify-end pt-2">
                <Button 
                  type="submit" 
                  disabled={createIdea.isPending || isRecording || !form.formState.isValid}
                  className="px-6 shadow-sm"
                >
                  <Send className="mr-2 h-4 w-4" />
                  {createIdea.isPending ? "Saving..." : "Save Fragment"}
                </Button>
              </div>
            </form>
          </Form>
        )}
      </CardContent>
    </Card>
  );
}
