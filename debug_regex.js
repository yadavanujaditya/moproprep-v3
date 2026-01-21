const explanation = `### 1. DIRECT ANSWER & CORE EXPLANATION
Option b is correct[cite: 346]. The posterior midline is the most common site (~90%) [cite: 336].

### 2. BREAKDOWN OF OPTIONS
- ✅ b (Posterior): Most frequent location [cite: 336].
- ❌ a (Anterior): Seen in ~10% females [cite: 336].
- ❌ c (Lateral): Suspect secondary causes like Crohn's[cite: 336].`;

function extractOptions(exp) {
    const options = {};
    const getPattern = (letter) => new RegExp(`^[\\s]*[-][\\s]*[✅❌]?[\\s]*${letter}[\\s]*[\"'(]*([^\\r\\n|)]+)[\\)]?`, 'im');

    ['a', 'b', 'c', 'd'].forEach(letter => {
        const pattern = getPattern(letter);
        const match = exp.match(pattern);
        if (match) {
            options[letter.toUpperCase()] = match[1].split(':')[0].trim();
        }
    });
    return options;
}

console.log('Results:', extractOptions(explanation));
