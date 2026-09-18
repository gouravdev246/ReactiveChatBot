export interface UserMemory {
    userId: string;
    userName: string;
    userAge: string;
    favourite: FavouriteThings[];
    studies: StudyInfo[];
    friends: FriendInfo[];
    dailyRoutine: DailyRoutine[];
    facts: Facts[];
    past_conversation : PastConversation[] ;
    current_mode : COMPANION ;

}
interface FavouriteThings {
    category: string;
    values: string[];
}

interface StudyInfo {
    school: string[];
    collage: string[];
}

interface FriendInfo {
    name: string;
    relation: string;
    specialThings: string;
}

interface DailyRoutine {
    workTime: string[];
    sleepTime: string[];
    classTime: string[];
    weakupTime: string[];

}
interface Facts{
    key : string ;
    value : string ;

}

interface PastConversation {
    last_conversation : Date ;
    topic : string ;
    last_message : string ;
}

export enum COMPANION {
    FAMILY = "FAMILY",
    FRIEND = "FRIEND",
    LOVER = "LOVER",
    TEACHER = "TEACHER",
    STUDENT = "STUDENT",
    MENTOR = "MENTOR" ,
    OTHER = "OTHER",

}