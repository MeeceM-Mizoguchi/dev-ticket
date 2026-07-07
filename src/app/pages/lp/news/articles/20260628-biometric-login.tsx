import { ScreenFigure, BiometricLoginScreen } from './screens';

/**
 * 記事本文。プレーンな HTML を書くだけで共通タイポグラフィが適用されます。
 * 画面イメージは実機能（LoginPage.tsx）をトレースした <BiometricLoginScreen /> を使用。
 */
export default function BiometricLogin() {
  return (
    <>
      <p>
        よりすばやく安全にサインインできる「生体認証ログイン」に対応しました。
        Face ID や Touch ID を使って、パスワードの入力なしでログインできます。
      </p>

      <ScreenFigure label="ログイン" caption="「または」の下に生体認証でのログインボタンが表示されます">
        <BiometricLoginScreen />
      </ScreenFigure>

      <h2>主な内容</h2>
      <ul>
        <li>Face ID / Touch ID による生体認証でのログインに対応</li>
        <li>パスワード入力が不要になり、毎日のサインインがスムーズに</li>
        <li>認証情報は端末内に安全に保管され、外部には送信されません</li>
      </ul>

      <h2>ご利用方法</h2>
      <p>
        対応端末でログイン後、設定画面から生体認証を有効化してください。
        次回以降のログインから、生体認証でのサインインをご利用いただけます。
      </p>
    </>
  );
}
