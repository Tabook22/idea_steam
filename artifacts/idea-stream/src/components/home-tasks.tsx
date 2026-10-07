import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Check, ListChecks } from "lucide-react";
import { getListTasksQueryKey, updateTask, useListTasks, type Task } from "@workspace/api-client-react";
import { groupTasks, todayKey } from "@/lib/task-dates";
import { useLanguage } from "@/lib/i18n";

const dirOf = (text: string) => (/[֐-ࣿ]/.test(text.slice(0, 30)) ? "rtl" : "ltr");

/** Open tasks due now (overdue and today), for the badge and the home card. */
export function useDueTasks() {
  const { data: tasks = [] } = useListTasks({ query: { queryKey: getListTasksQueryKey(), staleTime: 30_000 } });
  const groups = groupTasks(tasks, todayKey());
  return { due: [...groups.overdue, ...groups.today], groups, open: tasks.filter((task) => !task.done).length };
}

/** The top-bar checklist button, with how many tasks are due. */
export function TasksButton() {
  const { isArabic } = useLanguage();
  const { due } = useDueTasks();
  const label = isArabic ? `المهام${due.length ? `، ${due.length} مستحقة` : ""}` : `Tasks${due.length ? `, ${due.length} due` : ""}`;
  return (
    <Link href="/tasks" aria-label={label} title={label}
      className="relative inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:border-primary/40 hover:text-foreground">
      <ListChecks size={16} />
      <span className="hidden sm:inline">{isArabic ? "المهام" : "Tasks"}</span>
      {due.length > 0 && (
        <span className="absolute -end-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
          {due.length > 9 ? "9+" : due.length}
        </span>
      )}
    </Link>
  );
}

/** Home: what's due now (and next), tick off in place. */
export function HomeTasks() {
  const { isArabic } = useLanguage();
  const copy = (en: string, ar: string) => (isArabic ? ar : en);
  const queryClient = useQueryClient();
  const { due, groups, open } = useDueTasks();
  if (!open) return null;
  const shown: Array<{ task: Task; late: boolean }> = [
    ...groups.overdue.map((task) => ({ task, late: true })),
    ...groups.today.map((task) => ({ task, late: false })),
    ...groups.week.map((task) => ({ task, late: false })),
    ...groups.someday.map((task) => ({ task, late: false })),
  ].slice(0, 4);

  async function done(task: Task) {
    navigator.vibrate?.(12);
    queryClient.setQueryData<Task[]>(getListTasksQueryKey(), (list) => list?.map((item) => (item.id === task.id ? { ...item, done: true } : item)));
    await updateTask(task.id, { done: true }).catch(() => {});
    void queryClient.invalidateQueries({ queryKey: getListTasksQueryKey() });
  }

  return (
    <section aria-label={copy("Your tasks", "مهامك")} className="mb-5 rounded-[1.5rem] border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <ListChecks size={14} />
          {due.length ? copy(`${due.length} due now`, `${due.length} مستحقة الآن`) : copy("Your tasks", "مهامك")}
        </p>
        <Link href="/tasks" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          {copy(`All ${open}`, `الكل ${open}`)}<ArrowUpRight size={13} />
        </Link>
      </div>
      <ul className="mt-3 space-y-1">
        {shown.map(({ task, late }) => (
          <li key={task.id} className="flex items-start gap-3 rounded-xl px-1 py-1.5">
            <button type="button" role="checkbox" aria-checked={false} onClick={() => void done(task)}
              aria-label={copy(`Mark “${task.text}” as done`, `علّم «${task.text}» منجزة`)}
              className="group mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-muted-foreground/40 transition hover:border-primary hover:bg-primary/10">
              <Check size={11} strokeWidth={3} className="text-primary opacity-0 group-hover:opacity-100" />
            </button>
            <p dir={dirOf(task.text)} className="min-w-0 flex-1 text-start text-sm leading-6">{task.text}</p>
            {late && <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200">{copy("Late", "متأخرة")}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
