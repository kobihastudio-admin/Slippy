/**
 * Copyright © 2026 SolutionX Co., Ltd. (บริษัท โซลูชั่น เอ็กซ์ จำกัด)
 * All rights reserved.
 *
 * Migration 017 — Social Space & Shop
 * Creates posts, post_receipt_links, post_product_links, post_interactions,
 * social_follows, products, affiliate_links, campaigns tables.
 */

-- ─────────────────────────────────────────────────────────
-- 1. products  (must come before post_product_links / affiliate_links)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     uuid REFERENCES organizations(id) ON DELETE SET NULL,
  name            text NOT NULL,
  description     text,
  price           numeric(14,2),
  image_url       text,
  category        text,
  health_tags     text[] DEFAULT '{}',
  commission_rate numeric(5,2) DEFAULT 5.0,
  is_active       bool DEFAULT true,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_merchant ON products(merchant_id);
CREATE INDEX IF NOT EXISTS products_category ON products(category);
-- ─────────────────────────────────────────────────────────
-- 2. posts
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS posts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('protocol','review','challenge','stack')),
  title          text,
  body           text NOT NULL,
  media_urls     text[] DEFAULT '{}',
  receipt_ids    uuid[] DEFAULT '{}',
  is_published   bool DEFAULT true,
  likes_count    int DEFAULT 0,
  comments_count int DEFAULT 0,
  saves_count    int DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_author     ON posts(author_id);
CREATE INDEX IF NOT EXISTS posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS posts_published  ON posts(is_published, created_at DESC);
-- ─────────────────────────────────────────────────────────
-- 3. post_receipt_links
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_receipt_links (
  post_id     uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, document_id)
);
-- ─────────────────────────────────────────────────────────
-- 4. post_product_links
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_product_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id        uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  affiliate_code text,
  created_at     timestamptz DEFAULT now()
);
-- ─────────────────────────────────────────────────────────
-- 5. post_interactions
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_interactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('like','save','share')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, post_id, type)
);
CREATE INDEX IF NOT EXISTS post_interactions_post ON post_interactions(post_id);
CREATE INDEX IF NOT EXISTS post_interactions_user ON post_interactions(user_id);
-- ─────────────────────────────────────────────────────────
-- 6. social_follows
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS social_follows (
  follower_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz DEFAULT now(),
  PRIMARY KEY (follower_id, following_id)
);
CREATE INDEX IF NOT EXISTS social_follows_following ON social_follows(following_id);
-- ─────────────────────────────────────────────────────────
-- 7. affiliate_links
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS affiliate_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,
  clicks      int DEFAULT 0,
  conversions int DEFAULT 0,
  earnings    numeric(14,2) DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_links_creator ON affiliate_links(creator_id);
-- ─────────────────────────────────────────────────────────
-- 8. campaigns
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title        text NOT NULL,
  brief        text,
  budget       numeric(14,2),
  payment_type text CHECK (payment_type IN ('cpc','cpa','fixed')),
  rate         numeric(14,2),
  start_date   date,
  end_date     date,
  status       text DEFAULT 'draft' CHECK (status IN ('draft','active','completed','cancelled')),
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_merchant ON campaigns(merchant_id);
-- ─────────────────────────────────────────────────────────
-- 9. RLS
-- ─────────────────────────────────────────────────────────
ALTER TABLE posts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_receipt_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_product_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_interactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_follows     ENABLE ROW LEVEL SECURITY;
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_links    ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns          ENABLE ROW LEVEL SECURITY;
-- posts: published posts visible to all auth users; own posts full access
CREATE POLICY "posts: published readable"
  ON posts FOR SELECT
  USING (is_published = true);
CREATE POLICY "posts: own full access"
  ON posts FOR ALL
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);
-- post_receipt_links: readable by authenticated
CREATE POLICY "post_receipt_links: readable"
  ON post_receipt_links FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "post_receipt_links: insert own"
  ON post_receipt_links FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM posts WHERE id = post_id AND author_id = auth.uid())
  );
CREATE POLICY "post_receipt_links: delete own"
  ON post_receipt_links FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM posts WHERE id = post_id AND author_id = auth.uid())
  );
-- post_product_links: readable by authenticated
CREATE POLICY "post_product_links: readable"
  ON post_product_links FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "post_product_links: own insert"
  ON post_product_links FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM posts WHERE id = post_id AND author_id = auth.uid())
  );
-- post_interactions: own full access + read all
CREATE POLICY "post_interactions: readable"
  ON post_interactions FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "post_interactions: own write"
  ON post_interactions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
-- social_follows: own rows + read all
CREATE POLICY "social_follows: readable"
  ON social_follows FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "social_follows: own write"
  ON social_follows FOR ALL
  USING (auth.uid() = follower_id)
  WITH CHECK (auth.uid() = follower_id);
-- products: active products readable by all auth users
CREATE POLICY "products: active readable"
  ON products FOR SELECT
  USING (is_active = true OR auth.role() = 'authenticated');
CREATE POLICY "products: merchant write"
  ON products FOR INSERT
  WITH CHECK (
    merchant_id IS NULL OR
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_id = merchant_id
        AND user_id = auth.uid()
        AND role IN ('owner','admin')
    )
  );
CREATE POLICY "products: merchant update"
  ON products FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_id = merchant_id
        AND user_id = auth.uid()
        AND role IN ('owner','admin')
    )
  );
-- affiliate_links: own access
CREATE POLICY "affiliate_links: own access"
  ON affiliate_links FOR ALL
  USING (auth.uid() = creator_id)
  WITH CHECK (auth.uid() = creator_id);
-- campaigns: merchant access + readable by authenticated
CREATE POLICY "campaigns: readable"
  ON campaigns FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "campaigns: merchant write"
  ON campaigns FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_id = merchant_id
        AND user_id = auth.uid()
        AND role IN ('owner','admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM organization_members
      WHERE organization_id = merchant_id
        AND user_id = auth.uid()
        AND role IN ('owner','admin')
    )
  );
-- ─────────────────────────────────────────────────────────
-- 10. Grants
-- ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON posts              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON post_receipt_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON post_product_links TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON post_interactions  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON social_follows     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON products           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON affiliate_links    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns          TO authenticated;
