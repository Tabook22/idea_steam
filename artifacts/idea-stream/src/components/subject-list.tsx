import { useState } from "react";
import { Link } from "wouter";
import { formatDateTime } from "@/lib/formatters";
import { type Subject } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen, Search, ArrowRight, BookType, CalendarClock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/lib/i18n";

interface SubjectListProps {
  subjects: Subject[];
}

export function SubjectList({ subjects }: SubjectListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { language, isArabic, t } = useLanguage();

  const filteredSubjects = subjects.filter(subject => 
    subject.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (subject.intro && subject.intro.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("searchSubjects")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="ps-9 bg-card border-card-border"
        />
      </div>

      {filteredSubjects.length === 0 ? (
        <div className="text-center py-12 px-4 border border-dashed rounded-xl border-border">
          <BookType className="mx-auto h-12 w-12 text-muted-foreground/50 mb-3" />
          <p className="text-muted-foreground font-serif text-lg">{t("noSubjects")}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {searchQuery ? t("trySearch") : t("createFirst")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSubjects.map(subject => (
            <Link key={subject.id} href={`/subjects/${subject.id}`}>
              <Card className="h-full hover-elevate transition-all duration-300 border-border hover:border-primary/30 group cursor-pointer overflow-hidden bg-card/50 hover:bg-card">
                <CardContent className="p-5 h-full flex flex-col relative">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-serif font-semibold text-lg line-clamp-2 leading-tight group-hover:text-primary transition-colors">
                      {subject.title}
                    </h3>
                    <div className="h-8 w-8 rounded-full bg-primary/5 flex items-center justify-center shrink-0 ms-2 group-hover:bg-primary/10 transition-colors">
                      <BookOpen className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                  
                  {subject.intro ? (
                    <p className="text-sm text-muted-foreground line-clamp-3 mb-4 flex-1">
                      {subject.intro}
                    </p>
                  ) : (
                    <div className="flex-1"></div>
                  )}
                  
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                    <span>{formatDateTime(subject.createdAt, language)}</span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground mt-auto pt-4 border-t border-border/50">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent/80"></span>
                      {new Intl.NumberFormat(language).format(subject.ideaCount)} {subject.ideaCount === 1 ? t("fragment") : t("fragments")}
                    </span>
                    <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-primary">
                      {t("open")} <ArrowRight className={`h-3 w-3 ${isArabic ? "rotate-180" : ""}`} />
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
