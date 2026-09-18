import express, { type Request, type Response, type Application } from 'express';
import cors from 'cors' ;
import dotenv from "dotenv";


dotenv.config();

const app : Application = express() ;
app.use(cors());
app.use(express.json());

app.get("/", (req : Request , res : Response ) => {
    res.send("Hello World!");
})

export default app;

