# Infrastructure as (GenAI) Code
Creating a chatbot on AWS using LLMs to generate the code. 

## Description
This is an attempt and playground, mostly for my own use, playing with CDKTF and AWS Services like Bedrock. The ultimate goal is to create a working chatbot that helps me choose what to read next, based on my Goodreads library.

My goals with this project:

- I wanted to try building something from start
- I wanted to learn about OpenID Connect
- I wanted to Use Github & Cloud State management
- I wanted to learn about CDKTF for AWS
- I wanted to learn about Bedrock & Agents

## Intended Architecture 
![Intended Architecture of the System](images/architecture.png?raw=true "Architecture")

## Issues
- Bedrock knowledge-base creation, due to missing index. (don't know how to fix yet)
- Lots of extra code & services due to multiple refactorings
- Horrible comments (should use https://www.conventionalcommits.org/en/v1.0.0/)
- Some DNS / CORS issues with the API GW call to my owned domain
