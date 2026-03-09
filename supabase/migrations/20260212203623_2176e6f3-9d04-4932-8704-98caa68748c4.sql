
CREATE TABLE public.glossaries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.glossaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own glossaries" 
ON public.glossaries 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own glossaries" 
ON public.glossaries 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own glossaries" 
ON public.glossaries 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own glossaries" 
ON public.glossaries 
FOR DELETE 
USING (auth.uid() = user_id);

CREATE TRIGGER update_glossaries_updated_at
BEFORE UPDATE ON public.glossaries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
