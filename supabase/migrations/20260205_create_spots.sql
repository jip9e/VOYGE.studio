-- Create a table for travel spots
CREATE TABLE IF NOT EXISTS spots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT,
  category TEXT,
  vibe TEXT,
  coordinates JSONB, -- [lng, lat]
  full_address TEXT,
  thumbnail TEXT,
  original_link TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE spots ENABLE ROW LEVEL SECURITY;

-- Simple policies
CREATE POLICY "Users can view their own spots" ON spots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own spots" ON spots
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own spots" ON spots
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own spots" ON spots
  FOR DELETE USING (auth.uid() = user_id);
