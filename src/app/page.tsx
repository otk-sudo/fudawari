import { HomeScreen } from "@/features/home/HomeScreen";

export default function HomePage() {
  // TODO(T2-3)：公開定義から開催中のイベント名を読み込んで渡す。
  // それまでは開催中のイベントが分からないため、仮の値として null（「開催中：」を出さない）を渡す
  return <HomeScreen runningEventName={null} />;
}
