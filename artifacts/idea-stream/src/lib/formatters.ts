import {
  type Subject,
  type Idea,
  type SubjectDetail,
} from "@workspace/api-client-react";
import { format, formatDistanceToNow } from "date-fns";

export function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), "MMM d, yyyy");
  } catch (e) {
    return dateString;
  }
}

export function formatTimeAgo(dateString: string): string {
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  } catch (e) {
    return dateString;
  }
}
