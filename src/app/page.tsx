import styles from "./page.module.css";

export default function HomePage() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>札割りプランナー</h1>
      <p className={styles.lead}>
        艦これのイベントで、特効を踏まえて「どの艦をどの札に回すか」を計画するためのツールです。
      </p>
    </main>
  );
}
