import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Wand2, RefreshCw, Save, Sparkles, BookText } from "lucide-react";

import {
  CompilationInputTone,
  useCompileSubject,
  useUpdateSubject,
  getGetSubjectQueryKey,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useLanguage } from "@/lib/i18n";

interface CompilationViewProps {
  subjectId: number;
  draft: string | null | undefined;
  hasIdeas: boolean;
}

export function CompilationView({ subjectId, draft, hasIdeas }: CompilationViewProps) {
  const [tone, setTone] = useState<CompilationInputTone>(CompilationInputTone.clear);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();
  
  const compileSubject = useCompileSubject();
  const updateSubject = useUpdateSubject();

  // Reset edit state when draft changes externally
  useEffect(() => {
    if (!isEditing && draft) {
      setEditDraft(draft);
    }
  }, [draft, isEditing]);

  const handleCompile = () => {
    if (!hasIdeas) {
      toast({
        title: t("nothingToCompile"),
        description: t("addFragmentsFirst"),
      });
      return;
    }

    compileSubject.mutate(
      { subjectId, data: { tone } },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: getGetSubjectQueryKey(subjectId) });
          setEditDraft(data.draft);
          setIsEditing(false);
          toast({
            title: t("compilationComplete"),
            description: t("compilationCompleteDetail"),
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("compilationFailed"),
            description: t("compilationFailedDetail"),
          });
        }
      }
    );
  };

  const handleSaveEdit = () => {
    if (editDraft === draft) {
      setIsEditing(false);
      return;
    }

    updateSubject.mutate(
      { subjectId, data: { draft: editDraft } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSubjectQueryKey(subjectId) });
          setIsEditing(false);
          toast({
            title: t("draftSaved"),
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: t("error"),
            description: t("draftSaveFailed"),
          });
        }
      }
    );
  };

  const handleStartEdit = () => {
    setEditDraft(draft || "");
    setIsEditing(true);
  };

  if (!draft && !compileSubject.isPending) {
    return (
      <Card className="h-full border-primary/20 bg-card/80 shadow-md flex flex-col items-center justify-center p-6 md:p-8 text-center min-h-[400px]">
        <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4 md:mb-6">
          <Wand2 className="h-6 w-6 md:h-8 md:w-8 text-primary" />
        </div>
        <CardTitle className="font-serif text-xl md:text-2xl mb-2">{t("shapeDraft")}</CardTitle>
        <CardDescription className="text-sm md:text-base max-w-sm mx-auto mb-6 md:mb-8 font-serif leading-relaxed">
          {t("shapeDraftDetail")}
        </CardDescription>
        
        <div className="w-full max-w-xs space-y-4">
          <Select 
            value={tone} 
            onValueChange={(val) => setTone(val as CompilationInputTone)}
            disabled={!hasIdeas}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("selectTone")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CompilationInputTone.clear}>{t("clearDirect")}</SelectItem>
              <SelectItem value={CompilationInputTone.conversational}>{t("conversational")}</SelectItem>
              <SelectItem value={CompilationInputTone.academic}>{t("academic")}</SelectItem>
              <SelectItem value={CompilationInputTone.cinematic}>{t("cinematic")}</SelectItem>
            </SelectContent>
          </Select>
          
          <Button 
            className="w-full" 
            size="lg" 
            onClick={handleCompile}
            disabled={!hasIdeas || compileSubject.isPending}
          >
            <Sparkles className="me-2 h-4 w-4" />
            {t("compileFragments")}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col shadow-lg border-primary/30 bg-card overflow-hidden min-h-[500px]">
      <CardHeader className="border-b border-border/50 bg-primary/5 py-3 md:py-4 px-4 md:px-6 flex flex-row items-center justify-between space-y-0 sticky top-0 z-10 gap-2 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2">
          <BookText className="h-4 w-4 md:h-5 md:w-5 text-primary shrink-0" />
          <CardTitle className="font-serif text-lg md:text-xl truncate">{t("compiledDraft")}</CardTitle>
        </div>
        
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {!isEditing && (
            <Select 
              value={tone} 
              onValueChange={(val) => setTone(val as CompilationInputTone)}
              disabled={compileSubject.isPending}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder={t("selectTone")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CompilationInputTone.clear}>{t("clearDirect")}</SelectItem>
                <SelectItem value={CompilationInputTone.conversational}>{t("conversational")}</SelectItem>
                <SelectItem value={CompilationInputTone.academic}>{t("academic")}</SelectItem>
                <SelectItem value={CompilationInputTone.cinematic}>{t("cinematic")}</SelectItem>
              </SelectContent>
            </Select>
          )}

          {isEditing ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)} className="h-8">
                {t("cancel")}
              </Button>
              <Button size="sm" onClick={handleSaveEdit} disabled={updateSubject.isPending} className="h-8">
                <Save className="me-2 h-3.5 w-3.5" /> {t("save")}
              </Button>
            </>
          ) : (
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleCompile}
              disabled={compileSubject.isPending}
              className="h-8 border-primary/20 text-primary hover:bg-primary/10"
            >
              {compileSubject.isPending ? (
                <Loader2 className="me-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="me-2 h-3.5 w-3.5" />
              )}
              {t("recompile")}
            </Button>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0 overflow-hidden flex flex-col relative">
        {compileSubject.isPending && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-20 flex flex-col items-center justify-center">
            <div className="w-16 h-16 relative">
              <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin"></div>
              <Wand2 className="absolute inset-0 m-auto h-6 w-6 text-primary animate-pulse" />
            </div>
            <p className="mt-4 font-serif font-medium text-primary">{t("weaving")}</p>
          </div>
        )}
        
        {isEditing ? (
          <Textarea
            value={editDraft}
            onChange={(e) => setEditDraft(e.target.value)}
            className="flex-1 resize-none rounded-none border-0 focus-visible:ring-0 p-6 text-[1.05rem] font-serif leading-relaxed"
            autoFocus
          />
        ) : (
          <div 
            className="flex-1 overflow-auto p-6 prose prose-p:my-3 prose-headings:font-serif max-w-none prose-p:font-serif prose-p:leading-relaxed text-[1.05rem] text-foreground cursor-text"
            onClick={handleStartEdit}
            title="Click to edit"
          >
            {draft?.split('\n').map((paragraph, i) => (
              paragraph.startsWith('# ') ? <h1 key={i} className="text-2xl font-bold mt-6 mb-4">{paragraph.substring(2)}</h1> :
              paragraph.startsWith('## ') ? <h2 key={i} className="text-xl font-bold mt-5 mb-3">{paragraph.substring(3)}</h2> :
              paragraph.startsWith('### ') ? <h3 key={i} className="text-lg font-bold mt-4 mb-2">{paragraph.substring(4)}</h3> :
              paragraph ? <p key={i}>{paragraph}</p> : <br key={i} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
