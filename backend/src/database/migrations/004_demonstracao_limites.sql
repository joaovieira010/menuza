ALTER TABLE estabelecimentos ADD COLUMN demonstracao boolean NOT NULL DEFAULT false;
UPDATE estabelecimentos SET demonstracao=true WHERE slug IN ('hamburgueria-demo','doces-demo');
ALTER TABLE estabelecimentos ALTER COLUMN cor_principal SET DEFAULT '#7f3aed';
-- Compatibilidade com instalações que aplicaram a primeira extensão antes do trigger.
CREATE OR REPLACE FUNCTION verificar_limite_produtos() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE limite integer; quantidade integer;
BEGIN
 IF NEW.ativo THEN
  PERFORM id FROM estabelecimentos WHERE id=NEW.estabelecimento_id FOR UPDATE;
  SELECT p.limite_produtos INTO limite FROM assinaturas a JOIN planos p ON p.id=a.plano_id WHERE a.estabelecimento_id=NEW.estabelecimento_id;
  IF limite IS NOT NULL THEN
   SELECT count(*) INTO quantidade FROM produtos WHERE estabelecimento_id=NEW.estabelecimento_id AND ativo AND id<>NEW.id;
   IF quantidade>=limite THEN RAISE EXCEPTION 'Limite de produtos atingido' USING ERRCODE='P0001'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS produtos_limite ON produtos;
CREATE TRIGGER produtos_limite BEFORE INSERT OR UPDATE ON produtos FOR EACH ROW EXECUTE PROCEDURE verificar_limite_produtos();
