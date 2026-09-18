import app from "./src/app.js";

const PORT = process.env.PORT || 5002 ;
app.listen(PORT , () => {
    console.log(`Server is running on port ${PORT}`);
})