import { STATUS } from "../logic.js";

// 状態は色だけでなく文字でも示す
export default function StatusTag({ status, large = false }) {
  return <span className={`tag tag-${status}${large ? " tag-lg" : ""}`}>{STATUS[status].label}</span>;
}
