# Direção visual — Saipos Automation Logs

## Abordagens consideradas

### Theme Name: Mirtilo Operacional
Very Brief Intro: Um painel de observabilidade com base azul-mirtilo profunda, linguagem editorial e acentos cítricos para sinalizar fluxo, atenção e sucesso.
Probability: 0.07

### Theme Name: Vanilla Console
Very Brief Intro: Uma central de logs clara, quase papelaria, com fundo Vanilla dominante e azul usado como estrutura técnica.
Probability: 0.03

### Theme Name: Curaçao Signal
Very Brief Intro: Uma interface arejada e energética, com Curaçao em primeiro plano e Mirtilo reservado para navegação e estados críticos.
Probability: 0.08

## Abordagem escolhida: Mirtilo Operacional

### Design Movement
Swiss International Style aplicado a ferramentas operacionais: tipografia disciplinada, hierarquia assimétrica, elementos de instrumentação e muito contraste funcional.

### Core Principles
1. **Sinal antes da decoração:** cor e peso tipográfico comunicam estado, prioridade e risco.
2. **Densidade com respiro:** muita informação operacional, organizada em camadas com espaço suficiente para escaneabilidade.
3. **Rastros visuais:** linhas finas, timestamps monoespaçados e indicadores de execução tornam o sistema legível como instrumento.
4. **Marca com personalidade:** a logo Saipos aparece como âncora humana em uma superfície técnica.

### Color Philosophy
Mirtilo é a superfície principal e representa confiança, continuidade e profundidade operacional. Vanilla entra como área de leitura e contraste caloroso, evitando a frieza de um dashboard genérico. Curaçao funciona como pulso: aparece em ações, estados ativos, métricas positivas e detalhes de interação. Vermelho e âmbar são reservados para incidentes e atenção, sem competir com a marca.

### Layout Paradigm
Shell com sidebar persistente e área de trabalho em duas camadas: um cabeçalho de contexto compacto, seguido por faixa de telemetria e uma mesa de investigação assimétrica. A lista de eventos ocupa o maior campo; um rail lateral fixa filtros e ações rápidas. Em telas menores, o rail vira drawer e a navegação se reduz a uma barra superior compacta.

### Signature Elements
- Filetes verticais e pequenos marcadores de estado na cor Curaçao.
- Timestamps e identificadores em fonte monoespaçada, tratados como dados de primeira classe.
- Cards com recortes retos e sombras suaves, combinando superfícies Vanilla com molduras Mirtilho translúcidas.

### Interaction Philosophy
Toda interação deve dar uma resposta curta e inequívoca: seleção muda a faixa lateral, filtros atualizam a contagem, ações mostram toast contextual. Hover revela contexto, não apenas brilho. Atalhos e foco de teclado permanecem visíveis.

### Animation
Entradas curtas em ease-out, com cascata de 40ms entre cards de telemetria. Linhas de log não pulam de posição; apenas recebem realce de fundo e marcador lateral. Drawer e popover surgem do ponto de origem em 180–240ms. Nada essencial depende de animação e `prefers-reduced-motion` desativa movimentos não essenciais.

### Typography System
Display e títulos em **Space Grotesk**, com peso 600–700 e tracking levemente negativo. Corpo e UI em **DM Sans**, com pesos 400–600. Dados, IDs, expressões e timestamps em **IBM Plex Mono**, sempre com contraste alto e tamanho mínimo de 12px.

### Brand Essence
A camada de confiança para quem precisa entender o que suas automações fizeram, quando fizeram e onde falharam — sem ruído. Personalidade: **precisa, acolhedora, vigilante**.

### Brand Voice
Headlines são diretas e orientadas à ação. CTAs descrevem o próximo passo concreto. Microcopy é curta, humana e nunca alarmista sem motivo.

Exemplo de headline: “Tudo que suas automações disseram hoje.”

Exemplo de CTA: “Abrir o próximo incidente”.

### Wordmark & Logo
Usar a logo enviada como marca principal no cabeçalho, com uma moldura arredondada em Vanilla para preservar a silhueta do personagem e a assinatura inferior. O nome “Saipos” acompanha a marca em Space Grotesk sem substituir o símbolo.

### Signature Brand Color
**Mirtilo profundo — #1F2459**, usado em superfícies principais, navegação, títulos de alto contraste e foco visual da marca.

## Decisões de implementação

A primeira entrega será uma tela única, responsiva, com dados demonstrativos locais e interações funcionais de investigação: busca, filtros por nível, seleção de uma execução, copiar payload, pausar atualização e alternar período. O ponto de integração com dados reais ficará isolado em um arquivo de dados para facilitar a substituição posterior.

## Style Decisions

- Mirtilo deve funcionar como sistema estrutural no workspace: bordas superiores, rails, títulos, seleção e framing, não apenas como preenchimento da sidebar.
- A faixa de telemetria usa uma lógica de instrumento: grade contínua, divisórias finas, labels monoespaciais e menos sombra decorativa.
- O traço Curaçao se repete nas regiões principais como rail lateral, regra superior, marcador de execução e status ativo.
- A marca Saipos deve permanecer visível como lockup composto, com a mascote liderando e “Automation Logs” tratado como assinatura de produto.
