# PROMPTS

Registro de cada prompt da sessão, numerado, na íntegra.

## Prompt 1

Leia o README.md e os arquivos em data/. É o desafio de backend da Kraken. quero que você leia para ter mais contexto.

Quero que você analise o que eles pedem e escreva um REGRAS.md com as premissas e regras, cada uma com o porquê. Princípio geral: Quero ser o mais seguro possivel, e fazer a solução sempre pensando que isso sera usado em produção, com dados reais, e com um processod e deploy ou seja, nao iremos utilizar memoria, e sim sempre que possivel acessar o banco de dados, e sempre analisar para problemas de race condicion. "na dúvida, não credita" — creditar a mais é perda real; deixar de creditar se corrige depois.

Premissas que já defini:
- A linguagem é JavaScript (Node.js) e o banco é PostgreSQL.
- Uma conta é identificada pelo PAR routing_number + account_number, nunca só pelo account_number. Números de conta e routing são texto (zeros à esquerda importam.
- Dinheiro é tratado em centavos inteiros no código e BIGINT no banco, para evitar erro de ponto flutuante. Só USD.
- Linha 9 ("Deposited without known user") = depósitos válidos para contas sem cliente conhecido. Linhas 10 e 11 (menor e maior) consideram todos os depósitos válidos, inclusive os da linha 9.
- um deposito valido, é considerado para os routing_number conhecidos, se existir o routing_number mas n existir um accoun number, ele é considerado valido, e para um usuario desconhecidos
- Um id já processado não é processado de novo: a primeira versão vista é a que vale. Os arquivos são lidos em ordem alfabética, para o resultado ser determinístico.
- O stdout tem SOMENTE as 11 linhas do relatório, no formato exato. nao é para criar outros log, nem outro formato
- Cada `docker-compose up` começa com o banco vazio: se eu rodar, trocar os arquivos de data/ e rodar de novo, nada da execução anterior pode aparecer.

Não escreva código ainda. Me mostre o REGRAS.md e aponte o que você acha que ainda está em aberto.

Durante toda a sessão, salve cada prompt meu, numerado, em um PROMPTS.md.

## Prompt 2

Agora crie a infraestrutura e o esqueleto do projeto. Código, comentários e logs em inglês.

Docker:
- docker-compose.yml com um Postgres 16 e a imagem Node da aplicação (Node 22, Dockerfile na raiz, npm ci com package-lock.json, rodando como usuário node, data/ montado somente leitura).
- O banco precisa de healthcheck, e a aplicação só sobe depois que o banco estiver pronto (depends_on com service_healthy). Use `pg_isready -h 127.0.0.1`: na inicialização o Postgres sobe um servidor temporário que só aceita conexões locais, e checar pela rede evita o app conectar antes da hora.
- O Postgres deve guardar os dados em tmpfs, sem volume, para cada `docker-compose up` começar do zero.
- Tem que funcionar só com `docker-compose up`, num ambiente limpo, sem nenhum passo manual.

Estrutura por ser um job, e não um servidor, então não precisa de controller, no entanto vamos fazer um orquestrador seguindo clean architecture e código limpo:
- index.js: ponto de entrada (cria tabelas → seed → roda o job).
- jobs/: o core do fluxo.
- services/: operações e regras de negócio. Não escrevem SQL.
- repositories/: um por tabela, só SQL. Não decidem regra de negócio.
- validators/: funções puras, sem banco e sem arquivo.
- helpers/: dinheiro (centavos ↔ "x.xx") e log (stderr).
- db/: client (pool + função que executa um bloco numa transação do banco), seeder e schemas (arquivos .sql com IF NOT EXISTS).
- config/: variáveis de ambiente.

Banco:
- customers (com customer_id, deposit_count e total_deposited_cents, sempre atualizados);
- customer_accounts (chave no par routing + conta; caso exista um cliente com duas contas, essas contas devolvem o customer_id e ele é usado para calcular o caout e o deposit);
- deposits (todos os depósitos válidos, com customer_id NULL quando a conta não é de cliente).
O depósito e o total do cliente devem ser gravados na MESMA transação do banco.

Nomes claros: os nomes dos metodos e das variaveis proceisam ser claros e semanticamente corretos,.

Não implemente as regras de processamento ainda. Só suba a estrutura e confirme que `docker-compose up` sobe o banco, cria as tabelas e faz o seed.

## Prompt 3

Agora implemente o fluxo no job:

1. Loop em todos os arquivos .json de data/ (ordem alfabética; outros arquivos são ignorados).
2. Validação do arquivo, num arquivo próprio em validators/: precisa ser JSON válido, com o campo "transactions" sendo um array com no mínimo 1 item. Se falhar,  vai para o próximo arquivo. Um arquivo ruim nunca derruba o processamento.
3. Para cada transação, validação de estrutura : existem os campos id, to, from, to/from.routing_number, to/from.account_number, amount.amount e amount.currency, com os tipos corretos. Se falhar, registra o motivo e vai para a próxima transação.
4. Regras de negócio, nesta ordem:
   1) O to é igual ao from? Se sim, pula.
   2) O id já existe na tabela de depósitos? Se sim, pula.
   3) A conta de destino é de um cliente conhecido? Se sim, grava o depósito e soma valor e quantidade no cliente. Se não, grava o depósito como sem cliente (para a linha 9).
5. Depois de ler tudo, imprime as 11 linhas lidas DO BANCO, exatamente no formato do README.

## Prompt 4

Agora crie arquivos JSON de teste para validar as regras e encontrar edge cases. quero q esses arquivos sejam bem diferentes dos exemplos

irei listar alguns e quero q vc adicione outros, para isso, vc deve agir como um QA senior, focando em qualidade e escalabiliade 

- Coloque em test/fixtures/, FORA de data/, para não mudar o resultado das amostras.
- Crie um docker-compose.test.yml que monte test/fixtures/ no lugar de data/,
- Use valores redondos, para eu conferir as somas de cabeça.
- Use um cliente como padrao (ex.: Leonard McCoy): toda transação que DEVERIA ser recusada vai para a conta dele. Se ele aparecer com count > 0, alguma regra falhou.
- Ids no formato UUID, com prefixo do arquivo, para saber de onde veio cada um.

Cubra pelo menos:
- válidos: cliente com 2 contas (Spock), contas parecidas com zero à esquerda (Kirk × Wesley), conta da Kraken sem cliente, número de conta de um cliente em OUTRO banco, valor que prode dar problema com o ponto flutuante
- duplicatas: id idêntico em outro arquivo, mesmo id em maiúsculas, mesmo id com valor diferente, id repetido no mesmo arquivo;
- uma transação inválida para cada caso: sem id, id vazio, id numérico, id que não é UUID, sem to, from sem account_number, routing com 8 dígitos, conta com letras, valor como texto, valor null, sem amount, valor 1e400 (vira Infinity), valor 0, valor negativo, valor com 3 casas (10.005), moeda EUR, moeda "usd" minúscula, origem igual ao destino, destino num banco que não é da Kraken, transação que não é objeto;
- arquivos: JSON quebrado, sem "transactions", "transactions" que não é array, transaction_count diferente do tamanho do array, arquivo .txt com JSON válido dentro;
- valor gigante (100000000000000000) seguido de uma transação válida no mesmo arquivo.

Escreva um test/fixtures/README.md com cada arquivo, o que deve acontecer e o resultado esperado das 11 linhas. Rode e me mostre o resultado obtido.

## Prompt 5

Rode os testes e compare o resultado com o esperado. Não altere nenhum código: só me explique.

Quero um resumo com:
1. O que já está certo.
2. O que diverge do esperado, linha a linha do relatório, e qual caso causou cada diferença.
3. Casos que são recusados SEM aparecer no log.
4. Uma revisão do código procurando situações que ninguém analisou: valores que derrubam o job inteiro, erros do banco no meio do processamento, perda de precisão, ids em maiúsculas, transferências entre contas de clientes da Kraken, arquivos com BOM, etc. Teste de verdade antes de afirmar.

Para cada ponto, explique em linguagem simples, diga o que você recomenda e quais são os prós e contras. Deixe claro o que é exigência do README e o que é suposição sua.

## Prompt 6

pode fazer as seguintes recomendações Exigir UUID no validador  
	Comparar o id em minúsculas
	Exigir 9 dígitos em to e from adicionar mais essa validação 


esse comportamento esta certo
transaction_count errado não recusa o arquivo 

nenhum log q n seja o q o readme pediu n deve aparece

n vamos validar se existe um campo q n sabemos se vai vir (o caso do status) 

Estas são as minhas respostas aos pontos que você encontrou. São REGRAS QUE EU DEFINI: implemente e registre no DECISOES.md como decisões minhas, cada uma com o porquê abaixo. Se alguma já estiver implementada pelo prompt anterior, só confirme com um teste.

1. Mesmo id em maiúsculas (ex.: "01AAAAAA-…" e "01aaaaaa-…") é o MESMO depósito.
   Regra: normalizar o id para minúsculas antes de checar duplicata e de gravar.
   Por quê: UUID não diferencia maiúsculas de minúsculas; sem isso, o mesmo depósito seria creditado duas vezes.

2. Routing de 8 dígitos no from deve ser RECUSADO.
   Regra: routing_number com exatamente 9 dígitos e account_number só com dígitos, tanto no to quanto no from.
   Por quê: um campo corrompido torna o registro inteiro não confiável ("na dúvida, não credita"). Só NÃO verificamos o dígito verificador ABA do routing de origem, porque isso recusaria dinheiro legítimo.

3. transaction_count diferente do tamanho do array NÃO recusa o arquivo.
   Regra: ignorar transaction_count; o que vale é o array transactions. Sem aviso no log.
   Por quê: as transações que faltam não estão no arquivo de qualquer jeito; recusar o arquivo só jogaria fora as válidas. NÃO "corrija" esse comportamento.

4. Depósitos gigantes (ex.: dois de 50000000000000000.00) devem ser RECUSADOS na validação, nunca chegar a estourar o BIGINT.
   Regra: valor máximo de 90071992547409.91 (Number.MAX_SAFE_INTEGER em centavos). Se mesmo assim a SOMA de um cliente estourar o banco (erro classe 22), só aquela transação é pulada e o job segue.
   Por quê: um valor desses derrubava o job inteiro e ninguém recebia o relatório.

5. Id com caractere nulo (\u0000) ou com milhares de caracteres deve ser RECUSADO na validação.
   Regra: o id precisa estar no formato UUID (36 caracteres: hexadecimais e hífens). Não crie regra extra para esses casos.
   Por quê: o formato UUID já barra os dois antes de chegarem ao banco.

6. Se o banco cair no meio do processamento, inclusive fora de uma consulta (erro emitido pelo pool de conexões), o job deve PARAR DE FORMA CONTROLADA.
   Regra: tratar o evento de erro do pool (pool.on('error')) e passar pelo mesmo caminho dos erros de infraestrutura: registrar no stderr onde parou (arquivo e transação, quando houver), encerrar a conexão e sair com código 1, sem imprimir o relatório.
   Por quê: hoje o processo morre por conta própria, sem dizer onde parou. Parar é o certo; o que muda é parar de forma previsível e com uma mensagem clara.

7. Arquivo maior que a memória disponível: NÃO tratar.
   Regra: cada arquivo é carregado inteiro na memória. Registre no DECISOES.md como LIMITAÇÃO CONHECIDA, sem streaming e sem dependência nova.
   Por quê: cada arquivo é a resposta de uma chamada ao endpoint (poucos KB nas amostras); com a memória padrão do Node, arquivos de vários MB são lidos sem problema. E, se faltar memória, o job para sem creditar nada errado.

Depois de implementar:
- adicione aos fixtures os casos que ainda não estiverem lá (id em maiúsculas, routing de 8 dígitos no from, transaction_count divergente, dois valores gigantes para o mesmo cliente, id com \u0000, id muito longo) e atualize o resultado esperado no README dos fixtures;
- rode os fixtures e as amostras e compare automaticamente com o esperado;
- simule a queda do banco no meio de um arquivo e mostre que o job para com código 1, com a mensagem de onde parou e sem relatório;
- me mostre um resumo de cada um dos 7 pontos: antes × depois

## Prompt 7

agora valide tudo, como se fosse a avaliação da Kraken:

1. Ambiente limpo: remova os containers e as imagens do projeto e rode `docker-compose up` do zero.
2. Amostras: compare AUTOMATICAMENTE (diff) as 11 linhas com o resultado esperado. Confirme que o stdout tem só as 11 linhas e que as amostras não geram nenhum aviso.
3. Fixtures: compare automaticamente com o esperado do test/fixtures/README.md.
4. Ambiente novo a cada execução: rode, troque os arquivos de data/ e rode de novo, sem derrubar o banco; o segundo resultado não pode ter nada do primeiro.
5. Parar em erro de infraestrutura: simule uma queda de conexão no meio do processamento e confirme que o job para, com código 1, e não imprime o relatório.
6. Documentação × código: confira se o DECISOES.md, o README dos fixtures e os comentários batem com o que o código faz de verdade. Aponte qualquer comentário ou trecho desatualizado.

Me mostre um resumo do que passou e do que falhou. Corrija só o que for erro óbvio; o que envolver decisão, me pergunte.

## Prompt 8

agora crie os testes unitários:
 vc esta liberado para usar dependencias para acelerar o processo de teste, no final quero uma analise em relação ao coverage, mas no minimo essas validações precisam ser feitas 
. Os testes devem rodar com `npm test`, sem Docker e sem banco.
- Coloque em test/unit/, com um arquivo por módulo testado.
- Cubra:
  - validador de arquivo: cada motivo de recusa;
  - validador de transação: um teste por regra, incluindo as BORDAS (0.01 válido, 0 inválido; 2 casas válido, 3 inválido; 90071992547409.91 válido, 90071992547409.92 inválido; UUID em maiúsculas válido; routing com 8 e 10 dígitos);
  - helpers de dinheiro: conversão para centavos e formatação, incluindo 0.29, 0.1 e 1000.1;
  - classificação de erros do banco: classe 22 segue, os outros param;
  - regras do service de depósito (mesma conta, duplicata, cliente conhecido, sem cliente), usando repositories falsos, sem banco;
  - job: dado ruim do banco pula a transação; qualquer outro erro para o job sem imprimir o relatório.
- Os testes não podem mudar o comportamento do código. Se precisar mudar algo para conseguir testar, me pergunte antes.
- Rode `npm test` e me mostre o resultado. Confirme também que `docker-compose up` continua funcionando e que os testes não entram na imagem Docker.
