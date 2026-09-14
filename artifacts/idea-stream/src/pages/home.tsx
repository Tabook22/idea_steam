import { useListSubjects } from "@workspace/api-client-react";
import { CreateSubjectForm } from "@/components/create-subject-form";
import { SubjectList } from "@/components/subject-list";
import { Skeleton } from "@/components/ui/skeleton";

export default function HomePage() {
  const { data: subjects, isLoading, error } = useListSubjects();

  return (
    <div className="min-h-[100dvh] w-full flex flex-col items-center">
      {/* Hero Section */}
      <section className="w-full bg-[#e8e8e4] text-foreground py-16 md:py-24 px-6 relative overflow-hidden">
        {/* Subtle decorative pattern */}
        <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "radial-gradient(circle at 2px 2px, white 1px, transparent 0)", backgroundSize: "32px 32px" }}></div>
        
        <div className="max-w-4xl mx-auto relative z-10">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-semibold tracking-tight mb-4 text-balance">
            Shape your thoughts.
          </h1>
          <p className="text-muted-foreground text-lg md:text-xl max-w-2xl text-balance font-light">
            A quiet space to collect fragments over days or weeks, and shape them into finished work when the time is right.
          </p>
          
          <div className="mt-10 max-w-xl bg-card rounded-xl p-2 shadow-xl">
            <CreateSubjectForm />
          </div>
        </div>
      </section>

      {/* Main Content */}
      <main className="w-full max-w-5xl mx-auto px-6 py-12 md:py-16 flex-1">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-serif font-semibold tracking-tight">Your Subjects</h2>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <div className="p-8 text-center bg-destructive/10 rounded-xl text-destructive border border-destructive/20">
            <p className="font-medium mb-1">Failed to load subjects</p>
            <p className="text-sm opacity-80">Please check your connection and try again.</p>
          </div>
        ) : (
          <SubjectList subjects={subjects || []} />
        )}
      </main>
    </div>
  );
}
