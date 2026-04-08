export class ContentGenerator {
    constructor() {
        this.status = 'idle';
    }

    async generate(topic) {
        this.status = 'generating';
        console.log(`Generating content for: ${topic}`);
        // Simulate AI generation
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const content = {
            id: Date.now(),
            title: `The Future of ${topic}`,
            body: `Discover how ${topic} is changing the world with OpenAutoGrowth.`,
            platforms: ['LinkedIn', 'Twitter', 'Instagram'],
            timestamp: new Date().toISOString()
        };
        
        this.status = 'done';
        return content;
    }
}
