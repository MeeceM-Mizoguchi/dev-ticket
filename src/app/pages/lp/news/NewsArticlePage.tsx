import { useParams, Navigate } from 'react-router';
import { NewsArticleLayout } from './NewsArticleLayout';
import { getArticle } from './newsRegistry';

/**
 * /news/:slug の動的レンダラ。台帳から記事を引き当てて描画する。
 * 該当が無ければ一覧へリダイレクト。
 */
export function NewsArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const entry = getArticle(slug);

  if (!entry) {
    return <Navigate to="/news" replace />;
  }

  const Body = entry.Component;
  return (
    <NewsArticleLayout entry={entry}>
      <Body />
    </NewsArticleLayout>
  );
}
